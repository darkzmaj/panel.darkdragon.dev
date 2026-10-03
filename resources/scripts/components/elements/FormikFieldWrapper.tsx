import React from 'react';
import { Field, FieldProps } from 'formik';
import InputError from '@/components/elements/InputError';
import Label from '@/components/elements/Label';

interface Props {
    id?: string;
    name: string;
    children: React.ReactNode;
    className?: string;
    label?: string;
    description?: string;
    validate?: (value: any) => undefined | string | Promise<any>;
}

const FormikFieldWrapper = ({ id, name, label, className, description, validate, children }: Props) => {
    // The label and the field it names must be linked, so the field gets an id when the caller did not set one.
    const inputId = id || `field-${name}`;

    return (
        <Field name={name} validate={validate}>
            {({ field, form: { errors, touched } }: FieldProps) => (
                <div className={`${className} ${touched[field.name] && errors[field.name] ? 'has-error' : undefined}`}>
                    {label && <Label htmlFor={inputId}>{label}</Label>}
                    {React.isValidElement(children) && !(children.props as { id?: string }).id
                        ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id: inputId })
                        : children}
                    <InputError errors={errors} touched={touched} name={field.name}>
                        {description || null}
                    </InputError>
                </div>
            )}
        </Field>
    );
};

export default FormikFieldWrapper;
