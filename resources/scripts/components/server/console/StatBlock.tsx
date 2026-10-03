import React from 'react';
import Icon from '@/components/elements/Icon';
import { IconDefinition } from '@/components/elements/icons';
import classNames from 'classnames';
import styles from './style.module.css';
import useFitText from 'use-fit-text';
import CopyOnClick from '@/components/elements/CopyOnClick';

interface StatBlockProps {
    title: string;
    copyOnClick?: string;
    // 'warn' / 'crit' tint the icon when a value approaches its limit.
    color?: 'warn' | 'crit' | undefined;
    icon: IconDefinition;
    children: React.ReactNode;
    className?: string;
}

export default ({ title, copyOnClick, icon, color, className, children }: StatBlockProps) => {
    const { fontSize, ref } = useFitText({ minFontSize: 8, maxFontSize: 500 });

    return (
        <CopyOnClick text={copyOnClick}>
            <div className={classNames(styles.stat_block, className)}>
                <div className={classNames(styles.icon, color && styles[color])}>
                    <Icon icon={icon} />
                </div>
                <div className={'flex flex-col justify-center overflow-hidden w-full'}>
                    <p className={'font-medium leading-tight text-xs md:text-sm text-neutral-300'}>{title}</p>
                    <div
                        ref={ref}
                        className={'h-[1.75rem] w-full font-semibold text-neutral-50 truncate'}
                        style={{ fontSize }}
                    >
                        {children}
                    </div>
                </div>
            </div>
        </CopyOnClick>
    );
};
