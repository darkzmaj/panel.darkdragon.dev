<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex">
        <title>Maintenance</title>
        <style>
            body { background: #1f2933; color: #cbd2d9; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; }
            main { max-width: 480px; margin: 12vh auto 0; padding: 0 16px; text-align: center; }
            h1 { font-weight: 500; color: #f5f7fa; font-size: 28px; }
            ul { list-style: none; padding: 0; margin: 24px auto 0; text-align: left; display: none; }
            li { padding: 3px 0; }
            li.done { color: #7bc47f; }
            li.running { color: #f5f7fa; }
            .bar { height: 4px; background: #3e4c59; border-radius: 2px; margin-top: 24px; display: none; }
            .bar div { height: 4px; background: #4098d7; border-radius: 2px; width: 0; transition: width .3s; }
        </style>
    </head>
    <body>
        <main>
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
