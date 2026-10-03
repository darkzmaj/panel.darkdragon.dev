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

    // ---- Row menus (the three-dot button in tables). One implementation: the menu is lifted to the body so a
    // scrolling table never clips it, placed beside its button, and closed by Escape, a click elsewhere or a choice.
    var openRowMenu = null;
    function closeRowMenu(refocus) {
        if (!openRowMenu) return;
        var o = openRowMenu;
        openRowMenu = null;
        o.menu.hidden = true;
        o.menu.style.cssText = '';
        o.home.appendChild(o.menu);
        o.button.setAttribute('aria-expanded', 'false');
        if (refocus) o.button.focus();
    }
    function placeRowMenu(o) {
        var r = o.button.getBoundingClientRect();
        var m = o.menu;
        m.style.position = 'fixed';
        m.style.zIndex = '80';
        m.style.right = 'auto';
        m.style.width = 'max-content';
        m.style.left = '0px';
        m.style.top = '0px';
        var w = m.offsetWidth;
        var h = m.offsetHeight;
        var left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
        var top = r.bottom + 6 + h > window.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : r.bottom + 6;
        m.style.left = left + 'px';
        m.style.top = top + 'px';
        m.style.right = 'auto';
    }
    document.addEventListener('click', function (e) {
        var button = e.target.closest && e.target.closest('[data-gb-menu]');
        if (button) {
            e.stopPropagation();
            var wasOpen = openRowMenu && openRowMenu.button === button;
            closeRowMenu(false);
            if (wasOpen) return;
            var menu = button.nextElementSibling;
            if (!menu || !menu.classList.contains('gb-dropdown-menu')) return;
            openRowMenu = { button: button, menu: menu, home: button.parentNode };
            document.body.appendChild(menu);
            menu.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            placeRowMenu(openRowMenu);
            var first = menu.querySelector('[role=menuitem]');
            if (first) first.focus();
            return;
        }
        if (openRowMenu && !openRowMenu.menu.contains(e.target)) closeRowMenu(false);
    });
    document.addEventListener('keydown', function (e) {
        if (!openRowMenu) return;
        if (e.key === 'Escape') { e.preventDefault(); closeRowMenu(true); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            var items = Array.prototype.slice.call(openRowMenu.menu.querySelectorAll('[role=menuitem]'));
            var index = items.indexOf(document.activeElement);
            index = e.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
            items[index].focus();
        }
        if (e.key === 'Tab') closeRowMenu(false);
    });
    window.addEventListener('resize', function () { closeRowMenu(false); });
    window.addEventListener('scroll', function () { closeRowMenu(false); }, true);

    // ---- Labels. Older admin forms put a label next to a field without linking them, or link it to an id that does
    // not exist. Where a form group has one label and one field, link them so screen readers announce the field and a
    // click on the label focuses it.
    var counter = 0;
    Array.prototype.forEach.call(document.querySelectorAll('.form-group'), function (group) {
        var labels = Array.prototype.filter.call(group.querySelectorAll(':scope > label, :scope > .control-label'), function (l) {
            var target = l.getAttribute('for');
            return !target || !document.getElementById(target);
        });
        var fields = group.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea');
        if (labels.length !== 1 || fields.length !== 1 || labels[0].querySelector('input, select, textarea')) return;
        var field = fields[0];
        if (!field.id) field.id = 'gb-field-' + (++counter);
        labels[0].setAttribute('for', field.id);
    });
    // Searchable selects draw their own box; give it the name of the field it replaces.
    setTimeout(function () {
        Array.prototype.forEach.call(document.querySelectorAll('select.select2-hidden-accessible'), function (select) {
            var label = select.id && document.querySelector('label[for="' + select.id + '"]');
            var box = select.parentNode.querySelector('.select2-selection');
            if (label && box && !box.getAttribute('aria-label')) box.setAttribute('aria-label', label.textContent.trim());
        });
    }, 400);

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
