import { ShieldAlert, TriangleAlert } from 'lucide-react';
import React from 'react';
import classNames from 'classnames';

interface AlertProps {
    type: 'warning' | 'danger';
    className?: string;
    children: React.ReactNode;
}

export default ({ type, className, children }: AlertProps) => {
    const tone = type === 'danger' ? 'var(--gb-danger)' : 'var(--gb-warning)';

    return (
        <div
            className={classNames('flex items-center px-4 py-3 text-sm', className)}
            style={{
                border: `1px solid rgb(${tone} / 0.35)`,
                background: `rgb(${tone} / 0.1)`,
                borderRadius: 'var(--gb-radius-md)',
                color: 'var(--gb-text-strong)',
            }}
            role={'alert'}
        >
            {type === 'danger' ? (
                <ShieldAlert className={'w-5 h-5 mr-3 flex-none'} style={{ color: `rgb(${tone})` }} aria-hidden />
            ) : (
                <TriangleAlert className={'w-5 h-5 mr-3 flex-none'} style={{ color: `rgb(${tone})` }} aria-hidden />
            )}
            {children}
        </div>
    );
};
