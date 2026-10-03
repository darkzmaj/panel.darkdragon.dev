import * as React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import PageContentBlock from '@/components/elements/PageContentBlock';
import PageHeader from '@/components/elements/PageHeader';
import ContentBox from '@/components/elements/ContentBox';
import useTheme from '@/plugins/useTheme';
import { ThemePreference } from '@/api/account/appearance';

const options: Array<{ value: ThemePreference; label: string; text: string; icon: typeof Sun }> = [
    { value: 'system', label: 'System', text: 'Match your device. Switches automatically at night.', icon: Monitor },
    { value: 'dark', label: 'Dark', text: 'Easy on the eyes in low light.', icon: Moon },
    { value: 'light', label: 'Light', text: 'Bright and crisp for well-lit rooms.', icon: Sun },
];

export default () => {
    const { theme, setTheme } = useTheme();

    return (
        <PageContentBlock title={'Appearance'}>
            <PageHeader
                title={'Appearance'}
                subtitle={'Choose how the Panel looks. Your choice follows you to every device.'}
            />
            <ContentBox title={'Theme'} description={'System follows your operating system setting.'}>
                <div
                    role={'radiogroup'}
                    aria-label={'Theme'}
                    style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}
                >
                    {options.map(({ value, label, text, icon: Icon }) => (
                        <button
                            key={value}
                            type={'button'}
                            role={'radio'}
                            aria-checked={theme === value}
                            className={'gb-option' + (theme === value ? ' selected' : '')}
                            style={{ alignItems: 'flex-start' }}
                            onClick={() => setTheme(value)}
                        >
                            <span className={'gb-file-icon'}>
                                <Icon aria-hidden />
                            </span>
                            <span>
                                <strong>{label}</strong>
                                <span>{text}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </ContentBox>
        </PageContentBlock>
    );
};
