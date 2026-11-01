'use strict';

const loginForm = document.getElementById('login');
const loginMessage = document.getElementById('login-message');

async function login(event) {
    event.preventDefault();
    const button = loginForm.querySelector('button');
    const password = document.getElementById('password');
    button.disabled = true;
    loginMessage.hidden = true;
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password.value }),
        });
        if (!response.ok) {
            const messages = {
                401: 'Anmeldung fehlgeschlagen.',
                403: 'Anmeldung über diese Adresse nicht möglich.',
                429: 'Zu viele Anmeldeversuche. Bitte versuche es später erneut.',
                503: 'Anmeldung derzeit nicht verfügbar.',
            };
            throw new Error(messages[response.status] || 'Anmeldung fehlgeschlagen. Bitte versuche es erneut.');
        }
        window.location.replace('/admin/');
    } catch (error) {
        loginMessage.textContent = error.message;
        loginMessage.hidden = false;
    } finally {
        password.value = '';
        button.disabled = false;
    }
}

loginForm.addEventListener('submit', login);
