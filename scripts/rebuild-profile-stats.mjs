const response = await base44.functions.invoke('rebuildProfileStats', { dryRun: true });
console.log(JSON.stringify(response.data, null, 2));
