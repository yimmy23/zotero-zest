// Reading tracker
pref("tracker.enable", true);
pref("tracker.sampleSeconds", 5);
pref("tracker.idleSeconds", 120);
pref("tracker.flushSeconds", 15);

// Read-status automation
pref("statusAuto.enable", true);
pref("statusAuto.readThreshold", 90);
pref("statusAuto.minMinutes", 5);

// Columns
pref("column.reading.enable", true);
pref("column.status.enable", true);
pref("column.rating.enable", true);
pref("column.tags.enable", true);
pref("column.textTags.enable", true);
// Annotations column: off by default (walking every attachment costs on first sort)
pref("column.annots.enable", false);
pref("annots.style", "bar");
pref("annots.color", "");

// Reading heat (Reading column + optional title decoration)
pref("heat.color", "#66ADFF");
pref("heat.opacity", "0.7");
pref("titleDecor.heat", true);
pref("titleDecor.unreadBold", true);
pref("titleDecor.unreadIncludesEmpty", false);

// Tags
pref("tags.hideInTitle", false);
pref("textTags.match", "#");
pref("textTags.color", "#4072E5");
pref("textTags.textColor", "auto");

// Rating
pref("rating.mark", "★");
pref("rating.option", "★");
pref("rating.color", "");
pref("rating.extraKey", "rate");

// Network (used by ranking / citation sources)
pref("network.email", "");
pref("network.cacheTTLHours", 168);

// Read-status automation: also mark items WITHOUT any status as In Progress
pref("statusAuto.markEmpty", false);
// Strip Read_Status / Read_Status_Date / Rating lines from exported Extra
pref("extra.stripOnExport", true);

// Graph pane (item-list bottom panel)
pref("graph.visible", false);
pref("graph.mode", "related");
pref("graph.height", 400);
pref("graph.maxNodes", 250);

// Nested tag tree
pref("nestedTags.show", false);
pref("nestedTags.linkSymbol", "/");
pref("nestedTags.sort", "az");
pref("nestedTags.showAllTags", false);
pref("nestedTags.matchChildTags", true);

// Journal rank / impact factor
pref("column.pubtags.enable", true);
pref("column.if.enable", false);
pref("column.venue.enable", false);
pref("rank.fields", "sciUp, sciif, sci");
pref("rank.sortBy", "");
pref("rank.map", "");
pref("rank.colors", "");
pref("rank.defaultColor", "");
pref("rank.textColor", "auto");
pref("rank.opacity", "0.15");
pref("rank.ttlDays", 30);
pref("rank.useEasyScholar", true);
pref("rank.useOpenAlex", true);
pref("rank.autoFetch", true);
pref("secret.easyscholar", "");
// IF column
pref("if.field", "sciif");
pref("if.max", 15);
pref("if.progress", true);
pref("if.info", true);
pref("if.color", "");

// Collection counts (off by default — Zotero deliberately hides these)
pref("collectionCounts.enable", false);
pref("collectionCounts.mode", 0);
