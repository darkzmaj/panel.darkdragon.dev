import React, { useState } from 'react';
import { Cpu, MemoryStick, Search } from 'lucide-react';

// Made-up rows. Nothing here comes from the server: the sign-in page must never load real instance data.
const ROWS = [
    { name: 'Proxy-01', node: 'eu-central', cpu: 18, ram: '1.2 GiB', state: 'running' },
    { name: 'Hub-01', node: 'eu-central', cpu: 42, ram: '2.8 GiB', state: 'running' },
    { name: 'Survival', node: 'eu-west', cpu: 0, ram: '0 MiB', state: 'offline' },
    { name: 'Game-01', node: 'us-east', cpu: 67, ram: '5.1 GiB', state: 'running' },
    { name: 'Build-01', node: 'us-east', cpu: 9, ram: '640 MiB', state: 'running' },
];

// A small picture of the Instances list for the sign-in page. The search box filters the made-up rows and a click
// selects one; there are no requests and no dependencies beyond two icons.
export default () => {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState('Hub-01');
    const q = query.trim().toLowerCase();
    const rows = ROWS.filter((r) => !q || r.name.toLowerCase().includes(q) || r.node.toLowerCase().includes(q));

    return (
        <div className={'gb-preview'} aria-label={'Preview of the instance list'}>
            <div className={'gb-preview-bar'} aria-hidden>
                <i />
                <i />
                <i />
                <span>gobia.cloud/instances</span>
            </div>
            <div className={'gb-preview-head'}>
                <strong>Instances</strong>
                <label className={'gb-preview-search'}>
                    <Search aria-hidden />
                    <input
                        type={'search'}
                        value={query}
                        onChange={(e) => setQuery(e.currentTarget.value)}
                        placeholder={'Search'}
                        aria-label={'Search the preview instances'}
                        autoComplete={'off'}
                    />
                </label>
            </div>
            <div className={'gb-preview-rows'}>
                {rows.map((row) => (
                    <button
                        key={row.name}
                        type={'button'}
                        className={'gb-preview-row' + (row.name === active ? ' active' : '')}
                        aria-pressed={row.name === active}
                        tabIndex={-1}
                        onClick={() => setActive(row.name)}
                    >
                        <span className={'gb-dot ' + (row.state === 'running' ? 'gb-dot-success' : '')} />
                        <b>{row.name}</b>
                        <small>{row.node}</small>
                        <span className={'gb-preview-stat'}>
                            <Cpu aria-hidden /> {row.cpu}%
                        </span>
                        <span className={'gb-preview-stat'}>
                            <MemoryStick aria-hidden /> {row.ram}
                        </span>
                    </button>
                ))}
                {rows.length === 0 && <p className={'gb-preview-empty'}>No instances match &ldquo;{query}&rdquo;.</p>}
            </div>
        </div>
    );
};
