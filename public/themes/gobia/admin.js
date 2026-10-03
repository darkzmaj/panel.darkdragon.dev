/* Gobia admin shell behaviour: profile menu, mobile navigation drawer and theme choice. No dependencies. */
(function () {
    var app = document.getElementById('gbApp');
    if (!app) return;

    // ---- Mobile navigation drawer
    var toggle = document.getElementById('gbMenuToggle');
    var backdrop = document.getElementById('gbBackdrop');
    function setDrawer(open) {
        app.classList.toggle('gb-drawer-open', open);
        if (toggle) {
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
        }
    }
    if (toggle) toggle.addEventListener('click', function () { setDrawer(!app.classList.contains('gb-drawer-open')); });
    if (backdrop) backdrop.addEventListener('click', function () { setDrawer(false); });

    // ---- Profile menu
    var wrap = document.getElementById('gbUserMenu');
    var button = document.getElementById('gbUserToggle');
    var menu = wrap && wrap.querySelector('.gb-dropdown-menu');
    function setMenu(open) {
        if (!menu) return;
        menu.hidden = !open;
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            var first = menu.querySelector('[role=menuitem]');
            if (first) first.focus();
        }
    }
    if (button && menu) {
        button.addEventListener('click', function (e) { e.stopPropagation(); setMenu(menu.hidden); });
        document.addEventListener('mousedown', function (e) { if (!menu.hidden && !wrap.contains(e.target)) setMenu(false); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (!menu.hidden) { setMenu(false); button.focus(); }
                setDrawer(false);
            }
            if (!menu.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                var items = Array.prototype.slice.call(menu.querySelectorAll('[role=menuitem], [role=menuitemradio]'));
                var index = items.indexOf(document.activeElement);
                index = e.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
                items[index].focus();
            }
        });
    }

    // ---- Theme choice (applied at once, then stored on the account)
    function markTheme() {
        var current = document.documentElement.getAttribute('data-theme-pref') || 'system';
        Array.prototype.forEach.call(document.querySelectorAll('[data-theme-choice]'), function (el) {
            var on = el.getAttribute('data-theme-choice') === current;
            el.setAttribute('aria-checked', on ? 'true' : 'false');
            el.classList.toggle('selected', on);
        });
    }
    markTheme();
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-choice]'), function (el) {
        el.addEventListener('click', function () {
            var choice = el.getAttribute('data-theme-choice');
            if (window.__gobiaSetTheme) window.__gobiaSetTheme(choice);
            markTheme();
            var token = document.querySelector('meta[name=_token]');
            fetch('/api/client/account/appearance', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-TOKEN': token ? token.content : '', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({ theme: choice }),
            }).catch(function () {});
        });
    });
})();
