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
