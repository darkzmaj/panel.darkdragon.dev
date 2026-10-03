{{-- The Gobia Cloud footer. The React application renders the same markup (components/elements/GobiaFooter.tsx). --}}
<footer class="gb-footer">
    <div class="gb-footer-inner">
        <div class="gb-footer-grid">
            <div class="gb-footer-brand">
                <img src="/themes/gobia/img/logo-text-240.png" srcset="/themes/gobia/img/logo-text-240.png 1x, /themes/gobia/img/logo-text-480.png 2x" alt="Gobia Cloud" width="177" height="56">
                <p><strong>{{ $gobiaFooter['tagline_strong'] }}</strong>{{ $gobiaFooter['tagline'] }}</p>
            </div>
            @foreach($gobiaFooter['columns'] as $column)
                <nav aria-label="{{ ucfirst(strtolower($column['title'])) }}">
                    <h4>{{ $column['title'] }}</h4>
                    <ul>
                        @foreach($column['links'] as $link)
                            <li>
                                @if($link['soon'])
                                    <span class="gb-footer-soon-label">{{ $link['label'] }}</span> <span class="gb-soon">SOON</span>
                                @else
                                    <a href="{{ $link['href'] }}">{{ $link['label'] }}</a>
                                @endif
                            </li>
                        @endforeach
                    </ul>
                </nav>
            @endforeach
        </div>
        <div class="gb-footer-bottom">
            <div>
                <p>&copy; {{ date('Y') }} <strong>Gobia Cloud</strong>. All Rights Reserved.</p>
                <img class="gb-footer-watermark gb-only-dark" src="/themes/gobia/img/cryvex-240.png" alt="Official Cryvex Brand" width="110" height="56">
                <img class="gb-footer-watermark gb-only-light" src="/themes/gobia/img/cryvex-black-240.png" alt="Official Cryvex Brand" width="110" height="56">
            </div>
            <div class="gb-footer-tools">
                @if($gobiaFooter['discord_url'])
                    <a href="{{ $gobiaFooter['discord_url'] }}" aria-label="Discord" rel="noopener" target="_blank"><img src="/themes/gobia/img/discord.svg" alt=""></a>
                @endif
                <a href="/account/appearance" aria-label="Appearance settings"><i class="fa fa-cog"></i></a>
            </div>
        </div>
    </div>
</footer>
