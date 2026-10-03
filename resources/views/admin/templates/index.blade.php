@extends('layouts.admin')

@section('title')
    Templates
@endsection

@section('content-header')
    <h1>Templates<small>Blueprints for creating servers with fixed software, resources, placement and files.</small></h1>
    <ol class="breadcrumb">
        <li><a href="{{ route('admin.index') }}">Dashboard</a></li>
        <li class="active">Templates</li>
    </ol>
@endsection

@section('content')
    <div class="row">
        <div class="col-xs-12">
            <div class="box box-primary">
                <div class="box-header with-border">
                    <h3 class="box-title">Template List</h3>
                    <div class="box-tools">
                        <a href="{{ route('admin.templates.new') }}" class="btn btn-sm btn-primary">Create New</a>
                    </div>
                </div>
                <div class="box-body table-responsive no-padding">
                    <table class="table table-hover">
                        <tbody>
                            <tr>
                                <th>Name</th>
                                <th>Software</th>
                                <th>Resources</th>
                                <th>Placement</th>
                                <th class="text-center">Revision</th>
                                <th class="text-center">Instances</th>
                                <th class="text-center">Status</th>
                            </tr>
                            @forelse ($templates as $template)
                                <tr>
                                    <td>
                                        <a href="{{ route('admin.templates.view', $template->id) }}">{{ $template->name }}</a>
                                        <br><small class="text-muted"><code>{{ $template->slug }}</code></small>
                                    </td>
                                    <td>{{ $template->egg->name ?? '—' }}</td>
                                    <td>{{ $template->memory }} MB RAM &middot; {{ $template->disk }} MB disk</td>
                                    <td>{{ str_replace('_', ' ', $template->placement_mode) }}</td>
                                    <td class="text-center">r{{ $template->revision }}</td>
                                    <td class="text-center">{{ $template->instances_count }}</td>
                                    <td class="text-center">
                                        @if($template->enabled)
                                            <span class="label label-success">Enabled</span>
                                        @else
                                            <span class="label label-default">Disabled</span>
                                        @endif
                                    </td>
                                </tr>
                            @empty
                                <tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">No templates yet. Create one to start launching servers from a blueprint.</td></tr>
                            @endforelse
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
@endsection
