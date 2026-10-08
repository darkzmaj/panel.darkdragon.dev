/** Loading placeholder with the geometry of a Gobia page: heading, one line of context and a row of cards. */
export default function PageSkeleton() {
    return (
        <div className={'gb-skel-page'} role={'progressbar'} aria-label={'Loading'}>
            <div className={'gb-skeleton'} style={{ height: 32, width: 220 }} />
            <div className={'gb-skeleton'} style={{ height: 16, width: 340, maxWidth: '100%' }} />
            <div className={'gb-skel-grid'} style={{ marginTop: 14 }}>
                <div className={'gb-skeleton'} style={{ height: 180, borderRadius: 14 }} />
                <div className={'gb-skeleton'} style={{ height: 180, borderRadius: 14 }} />
            </div>
            <div className={'gb-skeleton'} style={{ height: 120, borderRadius: 14 }} />
        </div>
    );
}
