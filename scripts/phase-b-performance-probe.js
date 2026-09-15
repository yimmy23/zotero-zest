/** Synthetic author graph computation in the actual Zotero JS engine. */
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
)
  throw Error("Isolated dev profile required");
const clock = Zotero.getMainWindow().performance;
const result = {
  zotero: Zotero.version,
  kind: "Synthetic same-surname Item-like objects; real Gecko graph modules, no DB/HTTP/DOM rendering",
  results: [],
  ok: [],
  fail: [],
};
for (const count of [2000, 5000, 10000]) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: 8000000 + i,
    libraryID: 1,
    key: `ZPERF${i}`,
    firstCreator: "Wang",
    isRegularItem: () => true,
    getField: () => "",
    getCreators: () => [
      { lastName: "Wang", firstName: `Name${String(i).padStart(6, "0")}` },
    ],
  }));
  const slices = [];
  const begin = clock.now();
  const pending = dev.graphBuild.buildGraph(items, "author", {
    maxNodes: 250,
    onSlice: (ms) => slices.push(ms),
  });
  const initialBlockMs = clock.now() - begin;
  const graph = await pending;
  result.results.push({
    count,
    initialBlockMs,
    elapsedMs: clock.now() - begin,
    longestSliceMs: Math.max(...slices),
    slices: slices.length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  });
  (graph.nodes.length === 250 && graph.edges.length === 125 && slices.length > 1
    ? result.ok
    : result.fail
  ).push(`${count} graph remains connected and sliced`);
}
return result;
