// Only retry explicit Base44 entity-list throttling. Writes, network failures,
// ambiguous errors and other rate limits always propagate without retry.
export function withChallengeReadBackoff(client, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const service = client.asServiceRole;
  const entities = service.entities;
  const wrappedEntities = new Proxy(entities, { get(target, name) {
    const entity = Reflect.get(target, name, target);
    if (!entity || typeof entity !== 'object') return entity;
    return new Proxy(entity, { get(obj, key) {
      const value = Reflect.get(obj, key, obj);
      if (key !== 'filter' || typeof value !== 'function') return typeof value === 'function' ? value.bind(obj) : value;
      return async (...args) => {
        for (let attempt = 0; ; attempt++) {
          try { return await value.apply(obj, args); }
          catch (error) {
            const message = String(error?.message || '');
            const match = /Rate limit exceeded: entity_list\b[\s\S]*?Retry after (\d+)s/i.exec(message);
            if (!match || attempt >= 2) throw error;
            const seconds = Number(match[1]);
            if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) throw error;
            await sleep((seconds + 1) * 1000);
          }
        }
      };
    }});
  }});
  const wrappedService = new Proxy(service, { get(target, key) {
    return key === 'entities' ? wrappedEntities : Reflect.get(target, key, target);
  }});
  return new Proxy(client, { get(target, key) {
    return key === 'asServiceRole' ? wrappedService : Reflect.get(target, key, target);
  }});
}
