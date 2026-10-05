@inject('branding', 'Pterodactyl\Services\Media\BrandingService')
@if($favicon = $branding->url('favicon'))
    <link rel="icon" type="image/png" href="{{ $favicon }}">
    <link rel="apple-touch-icon" href="{{ $favicon }}">
@else
    <link rel="apple-touch-icon" sizes="180x180" href="/themes/gobia/img/apple-touch-icon.png?v=4">
    <link rel="icon" type="image/png" href="/themes/gobia/img/favicon-32.png?v=4" sizes="32x32">
    <link rel="shortcut icon" href="/themes/gobia/img/favicon-32.png?v=4">
@endif
