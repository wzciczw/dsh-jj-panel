/** Minimal commit shape the lane layout needs. */
export interface GraphCommit {
  changeId: string;
  commitId: string;
  parents: string[];
}

export interface GraphRow<T> {
  commit: T;
  lane: number;
  lanes: number;
  isFirstParentOfPrevious: boolean;
}

/**
 * Topological lane layout. Commits arrive newest-first (jj emits topological
 * order), each lane holds the commit id expected next; a commit claims the lane
 * already waiting for it, else an empty lane, else a new one. Its first parent
 * inherits the lane; extra parents take further lanes.
 */
export function layoutGraph<T extends GraphCommit>(commits: T[]): GraphRow<T>[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow<T>[] = [];
  let previousLane = -1;
  for (const commit of commits) {
    let lane = lanes.indexOf(commit.commitId);
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
    }
    lanes[lane] = null;
    const parents = commit.parents;
    const first = parents[0];
    if (first !== undefined) lanes[lane] = first;
    for (const parent of parents.slice(1)) {
      if (lanes.includes(parent)) continue;
      let slot = lanes.indexOf(null);
      if (slot === -1) {
        slot = lanes.length;
        lanes.push(parent);
      } else {
        lanes[slot] = parent;
      }
    }
    let width = lanes.length;
    while (width > 0 && lanes[width - 1] === null) width -= 1;
    rows.push({ commit, lane, lanes: Math.max(width, lane + 1), isFirstParentOfPrevious: lane === previousLane });
    previousLane = lane;
  }
  return rows;
}
