import { useId, type ChangeEvent, type ReactElement, type ReactNode } from 'react';

export function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: (id: string) => ReactElement;
}) {
    const id = useId();

    return (
        <div className={'gb-field'}>
            <label className={'gb-label'} htmlFor={id}>
                {label}
            </label>
            {children(id)}
            {hint && <p className={'gb-hint'}>{hint}</p>}
        </div>
    );
}

export function TextField({
    label,
    hint,
    value,
    onChange,
    placeholder,
    type = 'text',
    multiline = false,
}: {
    label: string;
    hint?: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: string;
    multiline?: boolean;
}) {
    return (
        <Field label={label} hint={hint}>
            {(id) =>
                multiline ? (
                    <textarea
                        id={id}
                        value={value}
                        placeholder={placeholder}
                        rows={3}
                        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value)}
                        className={'gb-input'}
                    />
                ) : (
                    <input
                        id={id}
                        type={type}
                        value={value}
                        placeholder={placeholder}
                        onChange={(event) => onChange(event.currentTarget.value)}
                        className={'gb-input'}
                    />
                )
            }
        </Field>
    );
}

export function NumberField({
    label,
    hint,
    value,
    onChange,
}: {
    label: string;
    hint?: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <Field label={label} hint={hint}>
            {(id) => (
                <input
                    id={id}
                    type={'number'}
                    inputMode={'numeric'}
                    value={value}
                    onChange={(event) => onChange(event.currentTarget.value)}
                    className={'gb-input'}
                />
            )}
        </Field>
    );
}

export function SelectField<T extends string | number>({
    label,
    hint,
    value,
    onChange,
    options,
    empty,
}: {
    label: string;
    hint?: string;
    value: T | null;
    onChange: (value: T) => void;
    options: { value: T; label: string }[];
    empty?: string;
}) {
    return (
        <Field label={label} hint={hint}>
            {(id) => (
                <select
                    id={id}
                    value={value ?? ''}
                    onChange={(event) => {
                        const chosen = options.find((option) => String(option.value) === event.currentTarget.value);
                        if (chosen) onChange(chosen.value);
                    }}
                    className={'gb-input'}
                >
                    {empty && <option value={''}>{empty}</option>}
                    {options.map((option) => (
                        <option key={String(option.value)} value={String(option.value)}>
                            {option.label}
                        </option>
                    ))}
                </select>
            )}
        </Field>
    );
}

export function Check({
    label,
    hint,
    checked,
    onChange,
}: {
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className={'gb-check'}>
            <input type={'checkbox'} checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
            <span>
                <strong>{label}</strong>
                {hint && <span className={'gb-hint'}>{hint}</span>}
            </span>
        </label>
    );
}

/** A card with a title bar. Inactive sections stay mounted (hidden) so every tab shares one form. */
export function Section({ title, active = true, children }: { title: string; active?: boolean; children: ReactNode }) {
    return (
        <section hidden={!active} className={'gb-card gb-section'}>
            <h2 className={'gb-section-head'}>{title}</h2>
            {children}
        </section>
    );
}
