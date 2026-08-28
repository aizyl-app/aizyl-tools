/* Jedno źródło nagłówka i stopki dla całego Aizyl Tools.
   Każda strona wstawia tylko <div id="aizyl-nav"></div> i <div id="aizyl-footer"></div>.
   Zmiana nawigacji = zmiana w tym jednym pliku. */
(function () {
  'use strict';

  var SITE = 'https://aizyl.pl';
  var DOWNLOAD = 'https://get.microsoft.com/installer/download/9NH3FKDG823D';

  var NAV_LINKS = [
    { label: 'Aizyl Tools',     href: '/' },
    { label: 'Aizyl DLP',    href: SITE + '/' },
    { label: 'Jak to działa', href: SITE + '/jak-to-dziala' },
    { label: 'Realne ryzyka', href: SITE + '/realne-ryzyka' }
  ];

  var FOOTER_LINKS = [
    { label: 'Polityka prywatności', href: SITE + '/polityka-prywatnosci' },
    { label: 'Regulamin',            href: SITE + '/regulamin' },
    { label: 'Program partnerski',   href: SITE + '/program-partnerski' },
    { label: 'kontakt@aizyl.pl',     href: 'mailto:kontakt@aizyl.pl' }
  ];

  function navHTML() {
    var here = location.pathname;
    var items = NAV_LINKS.map(function (l) {
      var active = (l.href === '/' && here === '/') ? ' aria-current="page"' : '';
      return '<li><a href="' + l.href + '"' + active + '>' + l.label + '</a></li>';
    }).join('');

    return '' +
      '<nav class="site-nav" id="site-nav">' +
        '<div class="container nav-inner">' +
          '<a href="/" class="nav-logo">A I Z Y L<span class="nav-logo-tools">tools</span></a>' +
          '<ul class="nav-links">' + items + '</ul>' +
          '<a href="' + DOWNLOAD + '" class="btn btn-primary nav-cta">' +
            '<span class="nav-cta-full">Pobierz Aizyl DLP →</span>' +
            '<span class="nav-cta-short">Pobierz</span>' +
          '</a>' +
          '<button class="nav-toggle" id="nav-toggle" aria-label="Menu" aria-expanded="false">' +
            '<span></span><span></span><span></span></button>' +
        '</div>' +
      '</nav>';
  }

  function footerHTML() {
    var links = FOOTER_LINKS.map(function (l) {
      return '<a href="' + l.href + '">' + l.label + '</a>';
    }).join('');

    return '' +
      '<footer class="site-footer">' +
        '<div class="container footer-inner">' +
          '<div class="footer-left">' +
            '<span class="footer-logo">A I Z Y L</span>' +
            '<span class="footer-copy">© ' + new Date().getFullYear() + ' Aizyl DLP</span>' +
          '</div>' +
          '<div class="footer-links">' + links + '</div>' +
        '</div>' +
      '</footer>';
  }

  function mount() {
    var navSlot = document.getElementById('aizyl-nav');
    var footSlot = document.getElementById('aizyl-footer');
    if (navSlot) navSlot.outerHTML = navHTML();
    if (footSlot) footSlot.outerHTML = footerHTML();

    var toggle = document.getElementById('nav-toggle');
    var nav = document.getElementById('site-nav');
    if (toggle && nav) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
