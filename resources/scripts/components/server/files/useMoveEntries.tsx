import React, { useCallback, useRef, useState } from 'react';
import { join } from 'pathe';
import { Actions, useStoreActions } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import { httpErrorToHuman } from '@/api/http';
import loadDirectory from '@/api/server/files/loadDirectory';
import renameFiles from '@/api/server/files/renameFiles';
import deleteFiles from '@/api/server/files/deleteFiles';
import Modal from '@/components/elements/Modal';
import { Button } from '@/components/elements/button/index';
import { checkMove, copyName, displayPath, normalize } from '@/components/server/files/fileOps';

export interface MovedEntry {
    from: string;
    to: string;
}

export interface MoveOutcome {
    moved: MovedEntry[];
    skipped: number;
    cancelled: boolean;
}

type Choice = 'replace' | 'keep-both' | 'skip' | 'cancel';
interface Pending {
    name: string;
    directory: string;
    remaining: number;
    resolve: (choice: Choice, all: boolean) => void;
}

/**
 * Moves entries between folders for both the file list and the workspace explorer. Moves that would put a folder
 * inside itself are refused; a name that already exists at the destination asks what to do (replace, keep both or
 * skip) instead of failing or silently overwriting. Callers learn exactly what moved so open editor tabs can follow.
 */
export default (uuid: string) => {
    const toast = useStoreActions((actions: Actions<ApplicationStore>) => actions.toasts.push);
    const [pending, setPending] = useState<Pending | null>(null);
    const [applyAll, setApplyAll] = useState(false);
    const busy = useRef(false);

    const ask = (name: string, directory: string, remaining: number) =>
        new Promise<{ choice: Choice; all: boolean }>((resolve) => {
            setApplyAll(false);
            setPending({ name, directory, remaining, resolve: (choice, all) => resolve({ choice, all }) });
        });

    const move = useCallback(
        async (sourceDirectory: string, names: string[], targetDirectory: string): Promise<MoveOutcome> => {
            const outcome: MoveOutcome = { moved: [], skipped: 0, cancelled: false };
            if (busy.current) return outcome;
            busy.current = true;

            try {
                const source = normalize(sourceDirectory);
                const target = normalize(targetDirectory);
                const existing = new Set((await loadDirectory(uuid, target)).map((f) => f.name));
                let sticky: Choice | null = null;

                for (let i = 0; i < names.length; ++i) {
                    const name = names[i];
                    const check = checkMove(join(source, name), target);
                    if (!check.ok) {
                        toast({ type: 'error', message: `${name}: ${check.reason}` });
                        outcome.skipped++;
                        continue;
                    }
                    if (check.noop) {
                        outcome.skipped++;
                        continue;
                    }

                    let destinationName = name;
                    if (existing.has(name)) {
                        let choice: Choice;
                        if (sticky) {
                            choice = sticky;
                        } else {
                            const answer = await ask(name, target, names.length - i - 1);
                            choice = answer.choice;
                            if (answer.all) sticky = choice;
                        }
                        if (choice === 'cancel') {
                            outcome.cancelled = true;
                            break;
                        }
                        if (choice === 'skip') {
                            outcome.skipped++;
                            continue;
                        }
                        if (choice === 'replace') {
                            await deleteFiles(uuid, target, [name]);
                        } else {
                            destinationName = copyName(name, existing);
                        }
                    }

                    await renameFiles(uuid, source, [{ from: name, to: join(target, destinationName) }]);
                    existing.add(destinationName);
                    outcome.moved.push({ from: join(source, name), to: join(target, destinationName) });
                }
            } catch (error) {
                toast({ type: 'error', message: `Move failed: ${httpErrorToHuman(error)}` });
            } finally {
                busy.current = false;
            }

            if (outcome.moved.length) {
                toast({
                    type: 'success',
                    message:
                        outcome.moved.length === 1
                            ? `Moved ${outcome.moved[0].from.split('/').pop()} to ${displayPath(targetDirectory)}`
                            : `Moved ${outcome.moved.length} items to ${displayPath(targetDirectory)}`,
                });
            }

            return outcome;
        },
        [uuid]
    );

    const answer = (choice: Choice) => {
        const current = pending;
        setPending(null);
        current?.resolve(choice, applyAll);
    };

    const dialog = (
        <Modal visible={!!pending} onDismissed={() => answer('cancel')} dismissable closeOnEscape>
            <h2 className={'gb-modal-title'}>Already exists</h2>
            <p className={'gb-modal-text'}>
                <strong>{pending?.name}</strong> is already in <code>{pending && displayPath(pending.directory)}</code>.
                What should happen to the one you are moving?
            </p>
            {!!pending && pending.remaining > 0 && (
                <label className={'gb-check'}>
                    <input
                        type={'checkbox'}
                        checked={applyAll}
                        onChange={(e) => setApplyAll(e.currentTarget.checked)}
                    />
                    Do this for the other {pending.remaining} conflict{pending.remaining === 1 ? '' : 's'} too
                </label>
            )}
            <div className={'gb-modal-actions'}>
                <Button.Text type={'button'} onClick={() => answer('cancel')}>
                    Cancel move
                </Button.Text>
                <Button.Text type={'button'} onClick={() => answer('skip')}>
                    Skip
                </Button.Text>
                <Button.Text type={'button'} onClick={() => answer('keep-both')}>
                    Keep both
                </Button.Text>
                <Button.Danger type={'button'} onClick={() => answer('replace')}>
                    Replace
                </Button.Danger>
            </div>
        </Modal>
    );

    return { move, dialog };
};
