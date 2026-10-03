@extends('layouts.admin')

@section('title')
    Users
@endsection

@section('content-header')
    <h1>Users<small>Everyone with an account on this Panel.</small></h1>
    <ol class="breadcrumb">
        <li><a href="{{ route('admin.index') }}">Dashboard</a></li>
        <li class="active">Users</li>
    </ol>
@endsection

@section('content')
@php
    $filters = request()->input('filter', []);
    $sort = request()->input('sort', '');
    $sortLink = fn (string $column) => request()->fullUrlWithQuery(['sort' => $sort === $column ? '-' . $column : $column]);
@endphp
<div class="row">
    <div class="col-xs-12">
        <div class="box box-primary">
            <div class="box-header with-border">
                <h3 class="box-title">User List <small class="gb-muted">{{ $users->total() }} total</small></h3>
                <div class="box-tools">
                    <a href="{{ route('admin.users.new') }}" class="btn btn-sm btn-primary">Create New</a>
                </div>
            </div>
            <div class="box-body">
                <form action="{{ route('admin.users') }}" method="GET" class="gb-user-filters">
                    <input type="text" name="filter[*]" class="form-control input-sm" value="{{ $filters['*'] ?? '' }}" placeholder="Search name, username or email" aria-label="Search users" style="min-width:240px;">
                    <select name="filter[role]" class="form-control input-sm" aria-label="Role">
                        <option value="">All roles</option>
                        <option value="admin" @selected(($filters['role'] ?? '') === 'admin')>Administrators</option>
                        <option value="user" @selected(($filters['role'] ?? '') === 'user')>Regular users</option>
                    </select>
                    <select name="filter[2fa]" class="form-control input-sm" aria-label="Two-factor authentication">
                        <option value="">Any 2FA status</option>
                        <option value="on" @selected(($filters['2fa'] ?? '') === 'on')>2FA enabled</option>
                        <option value="off" @selected(($filters['2fa'] ?? '') === 'off')>2FA disabled</option>
                    </select>
                    <button type="submit" class="btn btn-sm btn-default"><i class="fa fa-search"></i> Filter</button>
                    @if(!empty(array_filter($filters)))
                        <a href="{{ route('admin.users') }}" class="btn btn-sm btn-link">Clear</a>
                    @endif
                </form>
            </div>
            <div class="box-body table-responsive no-padding">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th style="width:48px;"></th>
                            <th><a href="{{ $sortLink('username') }}">Username</a></th>
                            <th><a href="{{ $sortLink('email') }}">Email</a></th>
                            <th>Role</th>
                            <th class="text-center">2FA</th>
                            <th class="text-center"><span data-toggle="tooltip" data-placement="top" title="Instances this user owns.">Owned</span></th>
                            <th class="text-center"><span data-toggle="tooltip" data-placement="top" title="Instances this user can open: owned plus those shared with them.">Accessible</span></th>
                            <th><a href="{{ $sortLink('created_at') }}">Created</a></th>
                            <th>Last activity</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($users as $user)
                            <tr class="align-middle">
                                <td><img src="{{ $user->avatar_url ? $user->avatar_url . '&s=64' : '/assets/svgs/default-avatar.svg' }}" class="gb-avatar" alt="" loading="lazy"></td>
                                <td><a href="{{ route('admin.users.view', $user->id) }}">{{ $user->username }}</a><div class="small gb-muted">{{ trim($user->name_first . ' ' . $user->name_last) }}</div></td>
                                <td>{{ $user->email }}</td>
                                <td>@if($user->root_admin)<span class="label label-warning">Administrator</span>@else<span class="label label-default">User</span>@endif</td>
                                <td class="text-center">
                                    @if($user->use_totp)
                                        <i class="fa fa-lock text-green" title="Enabled"></i><span class="sr-only">Enabled</span>
                                    @else
                                        <i class="fa fa-unlock text-red" title="Disabled"></i><span class="sr-only">Disabled</span>
                                    @endif
                                </td>
                                <td class="text-center"><a href="{{ route('admin.servers', ['filter[owner_id]' => $user->id]) }}">{{ $user->servers_count }}</a></td>
                                <td class="text-center">{{ $user->servers_count + $user->subuser_of_count }}</td>
                                <td>{{ $user->created_at->format('Y-m-d') }}</td>
                                <td>{{ $user->last_activity_at ? \Carbon\Carbon::parse($user->last_activity_at)->diffForHumans() : '-' }}</td>
                                <td class="text-right">
                                    <button type="button" class="gb-admin-menu" data-gb-menu aria-label="Actions for {{ $user->username }}" aria-haspopup="menu" aria-expanded="false"><i class="fa fa-ellipsis"></i></button>
                                    <div class="gb-dropdown-menu" role="menu" hidden>
                                        <a role="menuitem" href="{{ route('admin.users.view', $user->id) }}"><i class="fa fa-pencil"></i> Edit user</a>
                                        <a role="menuitem" href="{{ route('admin.servers', ['filter[owner_id]' => $user->id]) }}"><i class="fa fa-server"></i> Instances</a>
                                    </div>
                                </td>
                            </tr>
                        @empty
                            <tr><td colspan="10" class="text-center gb-muted">No users match these filters.</td></tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
            @if($users->hasPages())
                <div class="box-footer with-border">
                    <div class="col-md-12 text-center">{!! $users->appends(request()->query())->render() !!}</div>
                </div>
            @endif
        </div>
    </div>
</div>
@endsection
