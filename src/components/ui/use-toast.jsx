// Inspired by react-hot-toast library
import { useState, useEffect } from "react";

// Only one toast is ever visible at a time — additional toasts queue up and are
// shown sequentially once the current one has finished, so notifications never
// stack or overlap.
const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 250; // time to let the exit animation finish before unmounting
const DEFAULT_TOAST_DURATION = 2500; // standard informational toasts — brief, auto-dismissing
const DESTRUCTIVE_TOAST_DURATION = 4000; // errors may linger slightly longer

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
};

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

const toastTimeouts = new Map();
const autoDismissTimeouts = new Map();
// Toasts requested while one is already on screen wait here until it's gone.
const pendingQueue = [];

const clearAutoDismiss = (toastId) => {
  const timeout = autoDismissTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    autoDismissTimeouts.delete(toastId);
  }
};

const scheduleAutoDismiss = (toastId, duration) => {
  const timeout = setTimeout(() => {
    autoDismissTimeouts.delete(toastId);
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId });
  }, duration);
  autoDismissTimeouts.set(toastId, timeout);
};

function showNextQueuedToast() {
  if (memoryState.toasts.length > 0) return; // a toast is still on screen
  const next = pendingQueue.shift();
  if (!next) return;
  dispatch({ type: actionTypes.ADD_TOAST, toast: next });
  scheduleAutoDismiss(next.id, next.duration);
}

const addToRemoveQueue = (toastId) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: actionTypes.REMOVE_TOAST,
      toastId,
    });
    showNextQueuedToast();
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

const _clearFromRemoveQueue = (toastId) => {
  const timeout = toastTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    toastTimeouts.delete(toastId);
  }
};

export const reducer = (state, action) => {
  switch (action.type) {
    case actionTypes.ADD_TOAST:
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case actionTypes.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case actionTypes.DISMISS_TOAST: {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        clearAutoDismiss(toastId);
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          clearAutoDismiss(toast.id);
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      };
    }
    case actionTypes.REMOVE_TOAST:
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners = [];

let memoryState = { toasts: [] };

function dispatch(action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

function toast({ ...props }) {
  const id = genId();
  const duration = props.variant === "destructive" ? DESTRUCTIVE_TOAST_DURATION : DEFAULT_TOAST_DURATION;

  const update = (props) =>
    dispatch({
      type: actionTypes.UPDATE_TOAST,
      toast: { ...props, id },
    });

  const dismiss = () =>
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId: id });

  const newToast = {
    ...props,
    id,
    duration,
    open: true,
    onOpenChange: (open) => {
      if (!open) dismiss();
    },
  };

  if (memoryState.toasts.length > 0) {
    // Something is already on screen — queue this one so toasts are shown
    // sequentially instead of stacking or overlapping.
    pendingQueue.push(newToast);
  } else {
    dispatch({ type: actionTypes.ADD_TOAST, toast: newToast });
    scheduleAutoDismiss(id, duration);
  }

  return {
    id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] = useState(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId) => dispatch({ type: actionTypes.DISMISS_TOAST, toastId }),
  };
}

export { useToast, toast };