(() => {
    const profileButton = document.getElementById("profile-button");
    const dialog = document.getElementById("profile-dialog");
    if (!profileButton || !dialog) return;

    const closeButton = document.getElementById("profile-dialog-close");
    const authView = document.getElementById("auth-view");
    const accountView = document.getElementById("account-view");
    const signupPanel = document.getElementById("signup-panel");
    const loginPanel = document.getElementById("login-panel");
    const signupTab = document.getElementById("signup-tab");
    const loginTab = document.getElementById("login-tab");
    const signupForm = document.getElementById("signup-form");
    const loginForm = document.getElementById("login-form");
    const logoutButton = document.getElementById("logout-button");
    const signupPassword = document.getElementById("signup-password");
    const confirmPassword = document.getElementById("signup-confirm-password");

    function showMessage(message, scope = dialog) {
        scope.querySelectorAll("[data-auth-message]").forEach((element) => {
            element.textContent = message;
        });
    }

    function showForm(formName, clearMessages = true) {
        const showSignup = formName === "signup";
        signupPanel.hidden = !showSignup;
        loginPanel.hidden = showSignup;
        signupTab.classList.toggle("active", showSignup);
        loginTab.classList.toggle("active", !showSignup);
        signupTab.setAttribute("aria-selected", String(showSignup));
        loginTab.setAttribute("aria-selected", String(!showSignup));
        authView.hidden = false;
        accountView.hidden = true;
        if (clearMessages) showMessage("");
    }

    async function readJsonResponse(response) {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
        return data;
    }

    async function csrfHeaders() {
        const response = await fetch("/api/csrf", { cache: "no-store" });
        const data = await readJsonResponse(response);
        return { "Content-Type": "application/json", "X-CSRFToken": data.csrf_token };
    }

    async function submitAuthForm(form, endpoint, submitButton) {
        const data = Object.fromEntries(new FormData(form).entries());
        submitButton.disabled = true;
        const originalText = submitButton.textContent;
        submitButton.textContent = "Please wait...";
        showMessage("");
        try {
            const headers = await csrfHeaders();
            const response = await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(data),
            });
            await readJsonResponse(response);
            window.location.reload();
        } catch (error) {
            showMessage(error.message || "Unable to complete that request.");
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }
    }

    async function loadAccount() {
        try {
            const response = await fetch("/api/me", { cache: "no-store" });
            const data = await readJsonResponse(response);
            if (!data.authenticated || !data.user) return;

            const name = data.user.name || "SmoothPlays listener";
            profileButton.textContent = name.trim().charAt(0).toUpperCase() || "S";
            profileButton.setAttribute("aria-label", `Open profile for ${name}`);
            document.getElementById("account-name").textContent = name;
            document.getElementById("account-email").textContent = data.user.email || "";

            const picture = document.getElementById("account-picture");
            if (typeof data.user.picture === "string" && data.user.picture.startsWith("https://")) {
                picture.src = data.user.picture;
                picture.alt = `Profile photo for ${name}`;
                picture.hidden = false;
            } else {
                picture.removeAttribute("src");
                picture.alt = "";
                picture.hidden = true;
            }
            authView.hidden = true;
            accountView.hidden = false;
        } catch (error) {
            showMessage("Your account status could not be loaded. Please try again.");
        }
    }

    profileButton.addEventListener("click", async () => {
        showForm("signup");
        await loadAccount();
        dialog.showModal();
        const firstInput = dialog.querySelector(".auth-panel:not([hidden]) input");
        if (!accountView.hidden) logoutButton.focus();
        else firstInput?.focus();
    });

    closeButton.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
    });

    signupTab.addEventListener("click", () => showForm("signup"));
    loginTab.addEventListener("click", () => showForm("login"));
    dialog.querySelector("[data-show-login]").addEventListener("click", () => showForm("login"));
    dialog.querySelector("[data-show-signup]").addEventListener("click", () => showForm("signup"));

    function validatePasswordConfirmation() {
        confirmPassword.setCustomValidity(
            confirmPassword.value && signupPassword.value !== confirmPassword.value
                ? "Passwords do not match. Please try again."
                : ""
        );
    }

    signupPassword.addEventListener("input", validatePasswordConfirmation);
    confirmPassword.addEventListener("input", validatePasswordConfirmation);

    signupForm.addEventListener("submit", (event) => {
        event.preventDefault();
        validatePasswordConfirmation();
        if (!signupForm.reportValidity()) return;
        submitAuthForm(signupForm, "/signup", signupForm.querySelector("[type=submit]"));
    });

    loginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!loginForm.reportValidity()) return;
        submitAuthForm(loginForm, "/login", loginForm.querySelector("[type=submit]"));
    });

    document.querySelectorAll("[data-google-auth]").forEach((button) => {
        button.addEventListener("click", () => {
            button.disabled = true;
            button.textContent = "Connecting to Google...";
            window.location.assign("/auth/google");
        });
    });

    logoutButton.addEventListener("click", async () => {
        logoutButton.disabled = true;
        try {
            const response = await fetch("/logout", {
                method: "POST",
                headers: await csrfHeaders(),
            });
            await readJsonResponse(response);
            window.location.reload();
        } catch (error) {
            showMessage(error.message || "Unable to log out. Please try again.", accountView);
            logoutButton.disabled = false;
        }
    });

    const authError = new URLSearchParams(window.location.search).get("auth_error");
    const authErrorMessages = {
        google_unavailable: "Google sign-in is not configured yet. You can use email and password instead.",
        google_existing_account: "An account with this email already exists. Log in with your password; Google was not linked.",
        google_failed: "Google sign-in could not be completed. Please try again or use email and password.",
    };
    if (authError && authErrorMessages[authError]) {
        showForm("login", false);
        showMessage(authErrorMessages[authError], loginPanel);
        dialog.showModal();
        window.history.replaceState({}, "", window.location.pathname);
    }

    loadAccount();
})();