/* COLA STUDIO — 404: lost the thread (spool engraving). */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$;
  Cola.boot(function () {
    var host = $('[data-nf-art]');
    if (host) host.innerHTML = Cola.brand.engraving('spool', 'nf__engraving');
    var search = $('[data-nf-search]');
    if (search) search.addEventListener('click', function () { if (Cola.layout.openSearch) Cola.layout.openSearch(); });
  });
})();
