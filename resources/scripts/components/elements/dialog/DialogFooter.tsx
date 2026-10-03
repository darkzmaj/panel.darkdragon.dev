import React, { useContext } from 'react';
import { DialogContext } from './';
import { useDeepCompareEffect } from '@/plugins/useDeepCompareEffect';

export default ({ children }: { children: React.ReactNode }) => {
    const { setFooter } = useContext(DialogContext);

    useDeepCompareEffect(() => {
        setFooter(
            <div
                className={'px-6 py-4 flex items-center justify-end space-x-3'}
                style={{ borderTop: '1px solid var(--gb-border-muted)' }}
            >
                {children}
            </div>
        );
    }, [children]);

    return null;
};
