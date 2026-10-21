.import "Fr.js" as Fr

// Translate only known backend messages at the presentation boundary.
// Unknown responses stay intact; event titles and account names are never translated.
function message(value) {
    var text = String(value || "");
    var exact = "backend." + text;
    if (Object.prototype.hasOwnProperty.call(Fr.catalog, exact)) return Fr.t(exact);
    var keys = Object.keys(Fr.catalog).filter(function(key) {
        return key.indexOf("backend.") === 0 && /%[1-9][0-9]*/.test(key);
    });
    for (var i = 0; i < keys.length; i++) {
        var indices = [];
        var pattern = keys[i].slice(8).split(/(%[1-9][0-9]*)/).map(function(part) {
            if (/^%[1-9][0-9]*$/.test(part)) { indices.push(Number(part.slice(1))); return "([\\s\\S]+?)"; }
            return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }).join("");
        var found = new RegExp("^" + pattern + "$").exec(text);
        if (!found) continue;
        var args = [keys[i]];
        for (var n = 0; n < indices.length; n++) args[indices[n]] = found[n + 1];
        return Fr.t.apply(null, args);
    }
    return text;
}
