import type { ChangeEvent, ReactNode } from 'react';

const control =
    'gt:w-full gt:rounded-md gt:border gt:border-input gt:bg-background gt:px-3 gt:py-2 gt:text-sm gt:text-foreground gt:placeholder:text-muted-foreground gt:focus-visible:outline-2 gt:focus-visible:outline-ring';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <label className={'gt:flex gt:flex-col gt:gap-1 gt:text-sm'}>
            <span className={'gt:font-medium'}>{label}</span>
            {children}
            {hint && <span className={'gt:text-xs gt:text-muted-foreground'}>{hint}</span>}
        </label>
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
            {multiline ? (
                <textarea
                    value={value}
                    placeholder={placeholder}
                    rows={3}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value)}
                    className={control}
                />
            ) : (
                <input
                    type={type}
                    value={value}
                    placeholder={placeholder}
                    onChange={(event) => onChange(event.currentTarget.value)}
                    className={control}
                />
            )}
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
            <input
                type={'number'}
                inputMode={'numeric'}
                value={value}
                onChange={(event) => onChange(event.currentTarget.value)}
                className={control}
            />
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
            <select
                value={value ?? ''}
                onChange={(event) => {
                    const chosen = options.find((option) => String(option.value) === event.currentTarget.value);
                    if (chosen) onChange(chosen.value);
                }}
                className={control}
            >
                {empty && <option value={''}>{empty}</option>}
                {options.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                        {option.label}
                    </option>
                ))}
            </select>
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
        <label className={'gt:flex gt:items-start gt:gap-3 gt:text-sm'}>
            <input
                type={'checkbox'}
                checked={checked}
                onChange={(event) => onChange(event.currentTarget.checked)}
                className={'gt:mt-0.5 gt:size-4 gt:accent-primary'}
            />
            <span className={'gt:flex gt:flex-col'}>
                <span className={'gt:font-medium'}>{label}</span>
                {hint && <span className={'gt:text-xs gt:text-muted-foreground'}>{hint}</span>}
            </span>
        </label>
    );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className={'gt:flex gt:flex-col gt:gap-4 gt:rounded-lg gt:border gt:border-border gt:bg-card gt:p-4'}>
            <h2 className={'gt:text-sm gt:font-semibold gt:uppercase gt:tracking-wide gt:text-muted-foreground'}>
                {title}
            </h2>
            {children}
        </section>
    );
}
