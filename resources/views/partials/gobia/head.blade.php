{{-- Gobia design system: tokens, components, icons, and the theme bootstrap that runs before first paint (no flash). --}}
@php
    // The saved preference of a signed-in user wins, so the theme follows them between devices; guests use this browser's choice.
    $gobiaThemePref = auth()->check() ? (auth()->user()->theme ?: 'system') : null;
    $gobiaCss = fn (string $file) => '/themes/gobia/' . $file . '?v=' . (@filemtime(public_path('themes/gobia/' . $file)) ?: 1);
@endphp
<link rel="stylesheet" href="{{ $gobiaCss('gobia.css') }}">
<link rel="stylesheet" href="{{ $gobiaCss('icons.css') }}">
<link rel="preload" href="/themes/gobia/fonts/manrope-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<script>
    (function () {
        var d = document.documentElement, p = {!! json_encode($gobiaThemePref) !!}, l = null;
        try { l = localStorage.getItem('gobia-theme'); } catch (e) {}
        p = p || l || 'system';
        function apply() {
            var dark = p === 'dark' || (p === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
            d.setAttribute('data-theme', dark ? 'dark' : 'light');
            d.setAttribute('data-theme-pref', p);
        }
        apply();
        try { localStorage.setItem('gobia-theme', p); } catch (e) {}
        if (window.matchMedia) {
            var m = matchMedia('(prefers-color-scheme: dark)');
            var onChange = function () { if (p === 'system') { apply(); } };
            if (m.addEventListener) { m.addEventListener('change', onChange); } else if (m.addListener) { m.addListener(onChange); }
        }
        // Used by the account appearance page and the footer shortcut.
        window.__gobiaSetTheme = function (next) {
            p = next; apply();
            try { localStorage.setItem('gobia-theme', next); } catch (e) {}
        };
    })();
</script>
