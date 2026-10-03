import React from 'react';
import { Actions, State, useStoreActions, useStoreState } from 'easy-peasy';
import { Form, Formik, FormikHelpers } from 'formik';
import * as Yup from 'yup';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import Field from '@/components/elements/Field';
import { httpErrorToHuman } from '@/api/http';
import { ApplicationStore } from '@/state';
import tw from 'twin.macro';
import { Button } from '@/components/elements/button/index';

interface Values {
    username: string;
    password: string;
}

const schema = Yup.object().shape({
    username: Yup.string()
        .min(3)
        .max(191)
        .matches(
            /^[a-z0-9]([\w.-]+)[a-z0-9]$/i,
            'Usernames must start and end with a letter or number and may only contain letters, numbers, dashes, underscores, and periods.'
        )
        .required(),
    password: Yup.string().required('You must provide your current account password.'),
});

export default () => {
    const user = useStoreState((state: State<ApplicationStore>) => state.user.data);
    const updateUsername = useStoreActions((state: Actions<ApplicationStore>) => state.user.updateUsername);

    const { clearFlashes, addFlash } = useStoreActions((actions: Actions<ApplicationStore>) => actions.flashes);

    const submit = (values: Values, { resetForm, setSubmitting }: FormikHelpers<Values>) => {
        clearFlashes('account:username');

        updateUsername(values)
            .then(() =>
                addFlash({
                    type: 'success',
                    key: 'account:username',
                    message: 'Your username has been updated.',
                })
            )
            .catch((error) =>
                addFlash({
                    type: 'error',
                    key: 'account:username',
                    title: 'Error',
                    message: httpErrorToHuman(error),
                })
            )
            .then(() => {
                resetForm();
                setSubmitting(false);
            });
    };

    return (
        <Formik
            onSubmit={submit}
            validationSchema={schema}
            enableReinitialize
            initialValues={{ username: user!.username, password: '' }}
        >
            {({ isSubmitting, isValid, dirty }) => (
                <React.Fragment>
                    <SpinnerOverlay size={'large'} visible={isSubmitting} />
                    <Form css={tw`m-0`}>
                        <Field
                            id={'current_username'}
                            type={'text'}
                            name={'username'}
                            label={'Username'}
                            description={'Usernames are stored in lowercase and must be unique.'}
                        />
                        <div css={tw`mt-6`}>
                            <Field
                                id={'confirm_username_password'}
                                type={'password'}
                                name={'password'}
                                label={'Confirm Password'}
                            />
                        </div>
                        <div css={tw`mt-6`}>
                            <Button disabled={isSubmitting || !isValid || !dirty}>Update Username</Button>
                        </div>
                    </Form>
                </React.Fragment>
            )}
        </Formik>
    );
};
