@include('partials/admin.settings.notice')

@section('settings::nav')
    @yield('settings::notice')
    @include('partials.admin.section-tabs', ['section' => 'settings', 'active' => $activeTab === 'basic' ? 'general' : $activeTab])
@endsection
