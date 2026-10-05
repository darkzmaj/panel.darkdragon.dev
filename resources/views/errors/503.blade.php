<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex">
        <title>Maintenance</title>
        <style>
            :root { color-scheme: dark light; --bg: #0a111b; --surface: #101a27; --text: #e6edf6; --muted: #8fa3b8; --line: #243142; --primary: #4da3ff; --ok: #4ade80; }
            @media (prefers-color-scheme: light) { :root { --bg: #f3f6fa; --surface: #ffffff; --text: #14202e; --muted: #546579; --line: #d7dfe9; --primary: #1d6fd1; --ok: #15803d; } }
            body { background: var(--bg); color: var(--text); font-family: "Manrope", -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; }
            main { max-width: 460px; margin: 14vh auto 0; padding: 32px 28px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; text-align: center; box-sizing: border-box; width: calc(100% - 32px); }
            img { width: 56px; height: 56px; }
            h1 { font-weight: 700; font-size: 24px; margin: 16px 0 6px; }
            p { color: var(--muted); margin: 0; line-height: 1.5; }
            ul { list-style: none; padding: 0; margin: 24px auto 0; text-align: left; display: none; }
            li { padding: 3px 0; color: var(--muted); }
            li.done { color: var(--ok); }
            li.running { color: var(--text); }
            .bar { height: 4px; background: var(--line); border-radius: 2px; margin-top: 24px; display: none; }
            .bar div { height: 4px; background: var(--primary); border-radius: 2px; width: 0; transition: width .3s; }
            @media (prefers-reduced-motion: reduce) { .bar div { transition: none; } }
        </style>
    </head>
    <body>
        <main>
            <img src="/themes/gobia/img/icon-64.png?v=4" alt="">
            <h1>Down for maintenance</h1>
            <p id="message">The Panel is being updated and will be back shortly.</p>
            <div class="bar" id="bar"><div id="fill"></div></div>
            <ul id="steps"></ul>
        </main>
        <script>
            (function () {
                function tick() {
                    fetch('/system/update-progress', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (p) {
                        if (!p.active && p.steps.length === 0) { return; }
                        document.getElementById('bar').style.display = 'block';
                        document.getElementById('fill').style.width = p.percent + '%';
                        var list = document.getElementById('steps');
                        list.style.display = 'block';
                        list.innerHTML = '';
                        p.steps.forEach(function (s) {
                            var li = document.createElement('li');
                            li.className = s.status;
                            li.textContent = (s.status === 'done' ? '✓ ' : s.status === 'running' ? '→ ' : '· ') + s.label;
                            list.appendChild(li);
                        });
                        if (!p.active) { location.reload(); }
                    }).catch(function () {});
                }
                tick();
                setInterval(tick, 3000);
                setTimeout(function () { location.reload(); }, 60000);
            })();
        </script>
    </body>
</html>
