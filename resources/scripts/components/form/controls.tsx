import React from 'react';
import { cn } from '@/lib/cn';
import { Input as BaseInput } from '@base-ui/react/input';
import { NumberField } from '@base-ui/react/number-field';

interface ThemeProps {
    $isLight?: boolean;
    $hasError?: boolean;
}

const controlBaseClass = [
    'resize-none appearance-none outline-hidden w-full min-w-0',
    'h-10 px-3 border rounded-md text-sm transition-[border-color,box-shadow] duration-100',
    'bg-background border-input text-foreground shadow-none placeholder:text-muted-foreground',
    'focus:border-primary focus:ring-[3px] focus:ring-primary/20',
    'disabled:opacity-60 read-only:cursor-text read-only:bg-muted/40',
    'required:shadow-none invalid:shadow-none',
].join(' ');

const lightClass =
    'bg-background border-border text-foreground focus:border-primary disabled:bg-muted disabled:border-border';
const errorClass = [
    'text-destructive border-destructive hover:border-destructive',
    'focus:border-destructive focus:ring-destructive',
].join(' ');

const controlClass = ({ $isLight, $hasError }: ThemeProps, className?: string): string =>
    cn(controlBaseClass, $isLight && lightClass, $hasError && errorClass, className);

type WithStringClassName<TProps> = Omit<TProps, 'className'> & { className?: string };

type TextInputProps = ThemeProps & WithStringClassName<React.ComponentProps<typeof BaseInput>>;
type NumberInputProps = ThemeProps &
    Pick<
        React.ComponentProps<typeof NumberField.Root>,
        'value' | 'onValueChange' | 'min' | 'max' | 'step' | 'format' | 'disabled'
    > &
    WithStringClassName<Omit<React.ComponentProps<typeof NumberField.Input>, 'value' | 'onChange' | 'disabled'>>;

export const TextInput = ({ $isLight, $hasError, className, ...props }: TextInputProps) => (
    <BaseInput className={controlClass({ $isLight, $hasError }, className)} {...props} />
);

export const FileInput = ({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) => (
    <input
        {...props}
        type={'file'}
        className={cn(
            'block w-full min-w-0 rounded-md text-sm text-foreground',
            'file:mr-3 file:rounded-md file:border file:border-border file:bg-popover file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground',
            'enabled:cursor-pointer enabled:file:cursor-pointer enabled:hover:file:bg-secondary',
            'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            'disabled:cursor-default disabled:opacity-50',
            className
        )}
    />
);

export const TextArea = ({
    $isLight,
    $hasError,
    className,
    ...props
}: ThemeProps & React.ComponentProps<'textarea'>) => (
    <textarea className={controlClass({ $isLight, $hasError }, cn('h-auto min-h-24 py-2.5', className))} {...props} />
);

export const NumberInput = ({
    $isLight,
    $hasError,
    className,
    value,
    onValueChange,
    min,
    max,
    step,
    format,
    disabled,
    ...props
}: NumberInputProps) => (
    <NumberField.Root
        value={value}
        onValueChange={onValueChange}
        min={min}
        max={max}
        step={step}
        format={{ useGrouping: false, ...format }}
        disabled={disabled}
    >
        <NumberField.Input className={controlClass({ $isLight, $hasError }, className)} {...props} />
    </NumberField.Root>
);
