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

const emit = () => {
  for (const l of listeners) l();
};

const getCurrent = () => {
  let current: AiProgressTask | null = null;
  for (const task of tasks.values()) {
    if (!task.pending) continue;
    if (!current || task.startedAt > current.startedAt) current = task;
  }
  return current;
};

export const aiProgressStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): Snapshot {
    let pendingCount = 0;
    for (const t of tasks.values()) if (t.pending) pendingCount += 1;
    return { pendingCount, current: getCurrent() };
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
    emit();
    return id;
  },
  endTask(id: string) {
    const t = tasks.get(id);
    if (!t) return;
    t.pending = false;
    tasks.set(id, t);
    emit();
    // cleanup shortly after completion to avoid stale state
    setTimeout(() => {
      tasks.delete(id);
      emit();
    }, 400);
  },
};

