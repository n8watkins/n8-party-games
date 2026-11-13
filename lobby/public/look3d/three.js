// Where the 3D look gets three.js: the copy Cork & Bell already ships and the site already
// serves (its vendored build, r186). The party room adds no second copy, and a browser that has
// played Cork & Bell has it cached. If Cork & Bell ever stops being hosted, vendor three.js into
// this folder and point this one line at it.
export * from "/cork-and-bell/game/vendor/three.module.js";
