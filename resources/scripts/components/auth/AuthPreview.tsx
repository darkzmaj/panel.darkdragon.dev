import React, { useState } from 'react';
import { Cpu, MemoryStick, Search } from 'lucide-react';

const ROWS = [
    { name: 'Proxy-01', node: 'eu-central', cpu: 18, ram: '1.2 GiB', state: 'running' },
    { name: 'Hub-01', node: 'eu-central', cpu: 42, ram: '2.8 GiB', state: 'running' },
    { name: 'Survival', node: 'eu-west', cpu: 0, ram: '0 MiB', state: 'offline' },
];

// A small, static picture of the Instances list for the sign-in page. It shows no real data and loads nothing.
export default () => {
    const [active, setActive] = useState(1);

    return (
        <div className={'gb-preview'} aria-hidden>
            <div className={'gb-preview-bar'}>
                <i />
                <i />
                <i />
                <span>gobia.cloud/instances</span>
            </div>
            <div className={'gb-preview-head'}>
                <strong>Instances</strong>
                <span>
                    <Search /> Search
                </span>
            </div>
            {ROWS.map((row, i) => (
                <div
                    key={row.name}
                    className={'gb-preview-row' + (i === active ? ' active' : '')}
                    onMouseEnter={() => setActive(i)}
                >
                    <span className={'gb-dot ' + (row.state === 'running' ? 'gb-dot-success' : '')} />
                    <b>{row.name}</b>
                    <small>{row.node}</small>
                    <span className={'gb-preview-stat'}>
                        <Cpu /> {row.cpu}%
                    </span>
                    <span className={'gb-preview-stat'}>
                        <MemoryStick /> {row.ram}
                    </span>
                </div>
            ))}
        </div>
    );
};
