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

// Reading heat (Reading column + optional title decoration)
pref("heat.color", "#4a90e2");
pref("heat.opacity", "0.6");
pref("titleDecor.heat", true);
pref("titleDecor.unreadBold", true);

// Tags
pref("tags.hideInTitle", false);
pref("textTags.match", "#");
pref("textTags.color", "#8e44ad");

// Network (used by ranking / citation sources)
pref("network.email", "");
pref("network.cacheTTLHours", 168);
