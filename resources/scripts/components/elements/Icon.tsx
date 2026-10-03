import React, { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
    icon: LucideIcon;
    className?: string;
    style?: CSSProperties;
}

// A Lucide icon sized by the surrounding text (or the width / height classes passed in).
const Icon = ({ icon: Glyph, className, style }: Props) => (
    <Glyph
        aria-hidden
        className={className}
        style={{ display: 'inline-block', width: '1em', height: '1em', ...style }}
    />
);

export default Icon;
