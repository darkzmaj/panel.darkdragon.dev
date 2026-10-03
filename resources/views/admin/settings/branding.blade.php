@extends('layouts.admin')
@include('partials/admin.settings.nav', ['activeTab' => 'branding'])

@section('title')
    Branding
@endsection

@section('content-header')
    <h1>Branding<small>The logo and favicon shown across the Panel.</small></h1>
    <ol class="breadcrumb">
        <li><a href="{{ route('admin.index') }}">Dashboard</a></li>
        <li>Settings</li>
        <li class="active">Branding</li>
    </ol>
@endsection

@section('content')
    @yield('settings::nav')
    <p class="text-muted" style="margin-top:0;">Until you upload your own, the Panel uses the Gobia Cloud logo and icon. Uploads replace them everywhere, including the login page and the browser tab.</p>
@inject('branding', 'Pterodactyl\Services\Media\BrandingService')
    <div class="row">
        @foreach([
            'logo' => ['title' => 'Panel Logo', 'help' => 'Shown on the login page and in the navigation bar. PNG only, up to 2 MB. Larger images are scaled down to fit within 512x256 pixels.', 'default' => '/themes/gobia/img/logo-text-480.png', 'url' => $branding->url('logo'), 'height' => '96px'],
            'favicon' => ['title' => 'Favicon', 'help' => 'Shown in the browser tab. PNG only, up to 512 KB. A square image is recommended.', 'default' => '/themes/gobia/img/icon-256.png', 'url' => $branding->url('favicon'), 'height' => '48px'],
        ] as $asset => $meta)
            <div class="col-md-6">
                <div class="box">
                    <div class="box-header with-border">
                        <h3 class="box-title">{{ $meta['title'] }}</h3>
                    </div>
                    <div class="box-body">
                        <div class="form-group">
                            <label class="control-label">Current {{ strtolower($meta['title']) }}</label>
                            <div class="gb-asset-preview">
                                <img src="{{ $meta['url'] ?? $meta['default'] }}" alt="{{ $meta['title'] }}" style="max-height:{{ $meta['height'] }};">
                            </div>
                            <p class="text-muted small">{{ $meta['url'] ? 'Using a custom image.' : 'Using the default image.' }}</p>
                        </div>
                        <form action="{{ url('/admin/settings/branding/' . $asset) }}" method="POST" enctype="multipart/form-data">
                            {{ csrf_field() }}
                            <div class="form-group">
                                <label class="control-label" for="{{ $asset }}-file">Upload a new {{ $asset }}</label>
                                <input type="file" id="{{ $asset }}-file" name="{{ $asset }}" accept="image/png,.png" required>
                                <p class="text-muted small">{{ $meta['help'] }}</p>
                            </div>
                            <button type="submit" class="btn btn-sm btn-primary">Upload</button>
                        </form>
                    </div>
                    @if($meta['url'])
                        <div class="box-footer">
                            <form action="{{ url('/admin/settings/branding/' . $asset) }}" method="POST">
                                {{ csrf_field() }}
                                {{ method_field('DELETE') }}
                                <button type="submit" class="btn btn-sm btn-danger pull-right">Reset to default</button>
                            </form>
                        </div>
                    @endif
                </div>
            </div>
        @endforeach
    </div>

@endsection
