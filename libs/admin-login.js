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
                401: 'Sign-in failed.',
                403: 'Sign-in is not allowed from this address.',
                429: 'Too many sign-in attempts. Please try again later.',
                503: 'Sign-in is currently unavailable.',
            };
            throw new Error(messages[response.status] || 'Sign-in failed. Please try again.');
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
