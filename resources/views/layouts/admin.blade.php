<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="utf-8">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <title>{{ config('app.name', 'Gobia Cloud') }} - @yield('title')</title>
        <meta content="width=device-width, initial-scale=1" name="viewport">
        <meta name="_token" content="{{ csrf_token() }}">
        <meta name="robots" content="noindex">

        @include('partials.favicons')
        <meta name="theme-color" content="#0a0f17">

        @include('partials.gobia.head')
        @include('layouts.scripts')

        @section('scripts')
            {!! Theme::css('vendor/select2/select2.min.css?t={cache-version}') !!}
            {!! Theme::css('vendor/bootstrap/bootstrap.min.css?t={cache-version}') !!}
            {!! Theme::css('vendor/sweetalert/sweetalert.min.css?t={cache-version}') !!}
            {!! Theme::css('css/checkbox.css?t={cache-version}') !!}
            <link rel="stylesheet" href="/themes/gobia/admin.css?v={{ @filemtime(public_path('themes/gobia/admin.css')) ?: 1 }}">
        @show
    </head>
    <body class="gb-body gb-admin">
        @inject('branding', 'Pterodactyl\Services\Media\BrandingService')
        @php
            $route = Route::currentRouteName() ?? '';
            $in = fn (string ...$prefixes) => collect($prefixes)->contains(fn ($p) => \Illuminate\Support\Str::startsWith($route, $p));
            $updateAvailable = data_get(app(\Pterodactyl\Services\Updater\UpdateService::class)->cached(), 'available');
            $adminUser = Auth::user();
            $avatar = $adminUser->avatar_url ? $adminUser->avatar_url . '&s=64' : '/assets/svgs/default-avatar.svg';
        @endphp
        <div class="gb-app" id="gbApp">
            <header class="gb-topbar">
                <div class="gb-topbar-left">
                    <button type="button" class="gb-icon-btn gb-menu-toggle" id="gbMenuToggle" aria-label="Open navigation" aria-expanded="false"><i class="fa fa-lg fa-bars"></i></button>
                    <a href="{{ route('admin.index') }}" class="gb-topbar-brand" style="text-decoration:none" aria-label="{{ config('app.name', 'Gobia Cloud') }}">
                        @if($logo = $branding->url('logo'))
                            <img src="{{ $logo }}" alt="{{ config('app.name', 'Gobia Cloud') }}">
                        @else
                            <img src="/themes/gobia/img/logo-text-240.png" srcset="/themes/gobia/img/logo-text-240.png 1x, /themes/gobia/img/logo-text-480.png 2x" alt="{{ config('app.name', 'Gobia Cloud') }}">
                        @endif
                    </a>
                </div>
                <div class="gb-topbar-title">
                    <h1>@yield('topbar-title', 'Administration')</h1>
                    <p>{{ config('app.name', 'Gobia Cloud') }} Infrastructure</p>
                </div>
                <div class="gb-topbar-actions">
                    <a href="{{ route('index') }}" class="gb-btn gb-btn-sm gb-hide-sm" title="Leave the admin area"><i class="fa fa-server"></i> Instances</a>
                    <div class="gb-dropdown" id="gbUserMenu">
                        <button type="button" class="gb-user-btn" id="gbUserToggle" aria-haspopup="menu" aria-expanded="false">
                            <img src="{{ $avatar }}" alt="">
                            <span class="gb-user-name">{{ $adminUser->username }}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                        </button>
                        <div class="gb-menu gb-dropdown-menu" role="menu" hidden>
                            <div style="padding:8px 10px 10px;min-width:240px">
                                <div style="font-weight:700;color:var(--gb-text-strong)">{{ $adminUser->username }}</div>
                                <div class="gb-secondary" style="font-size:12px;overflow:hidden;text-overflow:ellipsis">{{ $adminUser->email }}</div>
                            </div>
                            <div class="gb-menu-sep"></div>
                            <a role="menuitem" class="gb-menu-item" href="/account"><i class="fa fa-user"></i> Account</a>
                            <a role="menuitem" class="gb-menu-item" href="/account/appearance"><i class="fa fa-cog"></i> Appearance</a>
                            <a role="menuitem" class="gb-menu-item" href="{{ route('index') }}"><i class="fa fa-server"></i> Instances</a>
                            <div class="gb-menu-sep"></div>
                            <div role="group" aria-label="Theme" class="gb-theme-switch">
                                <button type="button" role="menuitemradio" class="gb-menu-item" data-theme-choice="system" title="System">System</button>
                                <button type="button" role="menuitemradio" class="gb-menu-item" data-theme-choice="dark" title="Dark">Dark</button>
                                <button type="button" role="menuitemradio" class="gb-menu-item" data-theme-choice="light" title="Light">Light</button>
                            </div>
                            <div class="gb-menu-sep"></div>
                            <a role="menuitem" class="gb-menu-item" href="{{ route('auth.logout') }}" id="logoutButton"><i class="fa fa-sign-out"></i> Log out</a>
                        </div>
                    </div>
                </div>
            </header>
            <div class="gb-layout">
                <div class="gb-sidebar-wrap">
                    <aside class="gb-sidebar" aria-label="Administration">
                        <nav class="gb-sidebar-scroll">
                            <div class="gb-nav-label">Dashboard</div>
                            <a class="gb-nav-item {{ $route !== 'admin.index' ?: 'active' }}" href="{{ route('admin.index') }}"><i class="fa fa-home"></i> <span>Overview</span></a>
                            <a class="gb-nav-item {{ ! $in('admin.users') ?: 'active' }}" href="{{ route('admin.users') }}"><i class="fa fa-users"></i> <span>Users</span></a>
                            <div class="gb-nav-label">Network</div>
                            <a class="gb-nav-item {{ ! $in('admin.nodes', 'admin.servers', 'admin.locations') ?: 'active' }}" href="{{ route('admin.nodes') }}"><i class="fa fa-sitemap"></i> <span>Nodes</span></a>
                            <a class="gb-nav-item {{ ! $in('admin.templates') ?: 'active' }}" href="{{ route('admin.templates') }}"><i class="fa fa-clone"></i> <span>Templates</span></a>
                            <a class="gb-nav-item {{ ! $in('admin.mounts', 'admin.nests', 'admin.databases') ?: 'active' }}" href="{{ route('admin.mounts') }}"><i class="fa fa-cubes"></i> <span>Services</span></a>
                            <div class="gb-nav-label">System</div>
                            <a class="gb-nav-item {{ ! $in('admin.settings', 'admin.api') ?: 'active' }}" href="{{ route('admin.settings') }}"><i class="fa fa-wrench"></i> <span>Settings</span></a>
                            <a class="gb-nav-item {{ ! $in('admin.system') ?: 'active' }}" href="{{ route('admin.system.updates') }}">
                                <i class="fa fa-download"></i> <span>Updates</span>
                                @if($updateAvailable)<span class="gb-nav-badge">NEW</span>@endif
                            </a>
                        </nav>
                        <a class="gb-sidebar-foot" href="{{ route('index') }}">
                            <img src="/themes/gobia/img/icon-64.png" alt="">
                            <span style="min-width:0">
                                <strong>{{ config('app.name', 'Gobia Cloud') }}</strong>
                                <span>Back to instances</span>
                            </span>
                        </a>
                    </aside>
                </div>
                <div class="gb-drawer-backdrop" id="gbBackdrop"></div>
                <main class="gb-main" id="gb-main">
                    <div class="gb-main-inner">
                        <section class="content-header">
                            @yield('content-header')
                        </section>
                        <section class="content">
                            @if (count($errors) > 0)
                                <div class="alert alert-danger">
                                    There was an error validating the data provided.
                                    <ul>
                                        @foreach ($errors->all() as $error)
                                            <li>{{ $error }}</li>
                                        @endforeach
                                    </ul>
                                </div>
                            @endif
                            @foreach (Alert::getMessages() as $type => $messages)
                                @foreach ($messages as $message)
                                    <div class="alert alert-{{ $type }} alert-dismissable" role="alert">
                                        {{ $message }}
                                    </div>
                                @endforeach
                            @endforeach
                            @yield('content')
                        </section>
                    </div>
                </main>
            </div>
            @include('partials.gobia.footer')
        </div>
        @section('footer-scripts')
            <script src="/js/keyboard.polyfill.js" type="application/javascript"></script>
            <script>keyboardeventKeyPolyfill.polyfill();</script>

            {!! Theme::js('vendor/jquery/jquery.min.js?t={cache-version}') !!}
            {!! Theme::js('vendor/sweetalert/sweetalert.min.js?t={cache-version}') !!}
            {!! Theme::js('vendor/bootstrap/bootstrap.min.js?t={cache-version}') !!}
            {!! Theme::js('vendor/bootstrap-notify/bootstrap-notify.min.js?t={cache-version}') !!}
            {!! Theme::js('vendor/select2/select2.full.min.js?t={cache-version}') !!}
            {!! Theme::js('js/admin/functions.js?t={cache-version}') !!}
            <script src="/js/autocomplete.js" type="application/javascript"></script>
            <script src="/themes/gobia/admin.js?v={{ @filemtime(public_path('themes/gobia/admin.js')) ?: 1 }}"></script>

            @if(Auth::user()->root_admin)
                <script>
                    $('#logoutButton').on('click', function (event) {
                        event.preventDefault();

                        swal({
                            title: 'Do you want to log out?',
                            type: 'warning',
                            showCancelButton: true,
                            confirmButtonColor: '#d9534f',
                            cancelButtonColor: '#d33',
                            confirmButtonText: 'Log out'
                        }, function () {
                             $.ajax({
                                type: 'POST',
                                url: '{{ route('auth.logout') }}',
                                data: {
                                    _token: '{{ csrf_token() }}'
                                },complete: function () {
                                    window.location.href = '{{route('auth.login')}}';
                                }
                        });
                    });
                });
                </script>
            @endif

            <script>
                $(function () {
                    $('[data-toggle="tooltip"]').tooltip();
                })
            </script>
        @show
    </body>
</html>
