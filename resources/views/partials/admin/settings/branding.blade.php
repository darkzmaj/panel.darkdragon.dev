{{-- Logo and favicon uploads, shown on the General settings tab. --}}
@inject('branding', 'Pterodactyl\Services\Media\BrandingService')
<h3 class="gb-section-title" id="branding">Branding</h3>
    <div class="row">
        @foreach([
            'logo' => ['title' => 'Panel Logo', 'help' => 'Shown on the login page and in the navigation bar. PNG only, up to 2 MB. Larger images are scaled down to fit within 512x256 pixels.', 'default' => '/assets/svgs/pterodactyl.svg', 'url' => $branding->url('logo'), 'height' => '96px'],
            'favicon' => ['title' => 'Favicon', 'help' => 'Shown in the browser tab. PNG only, up to 512 KB. A square image is recommended.', 'default' => '/favicons/favicon-96x96.png', 'url' => $branding->url('favicon'), 'height' => '48px'],
        ] as $asset => $meta)
            <div class="col-md-6">
                <div class="box">
                    <div class="box-header with-border">
                        <h3 class="box-title">{{ $meta['title'] }}</h3>
                    </div>
                    <div class="box-body">
                        <div class="form-group">
                            <label class="control-label">Current {{ strtolower($meta['title']) }}</label>
                            <div style="background:#e7ecf2;padding:10px;text-align:center;">
                                <img src="{{ $meta['url'] ?? $meta['default'] }}" alt="{{ $meta['title'] }}" style="max-width:100%;max-height:{{ $meta['height'] }};width:auto;height:auto;">
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
