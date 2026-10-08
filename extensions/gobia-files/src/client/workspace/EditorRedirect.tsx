import { useCurrentServer, usePanelNavigate, type ReplacementProps } from '@pterodactyl/sdk';
import { useEffect } from 'react';
// The same key as `OPEN_KEY` in session.ts; not imported so the redirect and the workspace share no extra chunk.
const OPEN_KEY = (uuid: string) => `gobia-files:open:${uuid}`;

/**
 * Replaces the core file editor page: a link that points at it (an activity entry, a bookmark) lands in the workspace
 * with the file open, so there is one editor in the product.
 */
export default function EditorRedirect({ model }: ReplacementProps<'server.files.editor'>) {
    const navigate = usePanelNavigate();
    const server = useCurrentServer();
    const uuid = server?.attributes.uuid;
    const id = server?.attributes.identifier;

    useEffect(() => {
        if (!uuid || !id) return;
        try {
            if (!model.isNew) sessionStorage.setItem(OPEN_KEY(uuid), model.path);
        } catch {
            // Without storage the workspace simply opens with its own tabs.
        }
        void navigate({ to: '/server/$id/files', params: { id }, replace: true });
    }, [uuid, id, model.path, model.isNew, navigate]);

    return <div className={'gb-skeleton'} style={{ height: 320, borderRadius: 14 }} aria-busy />;
}
