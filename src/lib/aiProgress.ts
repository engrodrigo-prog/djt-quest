type AiProgressTask = {
  id: string;
  handler: string;
  taskKey: string;
  startedAt: number;
  pending: boolean;
};

type Snapshot = {
  pendingCount: number;
  current: AiProgressTask | null;
};

let tasks = new Map<string, AiProgressTask>();
let listeners = new Set<() => void>();
let snapshot: Snapshot = { pendingCount: 0, current: null };

const rebuildSnapshot = () => {
  let pendingCount = 0;
  let current: AiProgressTask | null = null;
  for (const task of tasks.values()) {
    if (!task.pending) continue;
    pendingCount += 1;
    if (!current || task.startedAt > current.startedAt) current = task;
  }
  snapshot = { pendingCount, current };
};

const emit = () => {
  for (const l of listeners) l();
};

export const aiProgressStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): Snapshot {
    return snapshot;
  },
  startTask(input: { handler: string; taskKey?: string }) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    tasks.set(id, {
      id,
      handler: input.handler,
      taskKey: input.taskKey || input.handler || "ai",
      startedAt: Date.now(),
      pending: true,
    });
    rebuildSnapshot();
    emit();
    return id;
  },
  endTask(id: string) {
    const t = tasks.get(id);
    if (!t) return;
    t.pending = false;
    tasks.set(id, t);
    rebuildSnapshot();
    emit();
    // cleanup shortly after completion to avoid stale state
    setTimeout(() => {
      tasks.delete(id);
      rebuildSnapshot();
      emit();
    }, 400);
  },
};
