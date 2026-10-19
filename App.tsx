    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;

        const viewport = (window as any).visualViewport;
        const applyKeyboardViewportOffset = () => {
            if (!viewport) {
                document.documentElement.style.setProperty('--keyboard-offset', '0px');
                return;
            }

            const keyboardOffset = Math.max(
                0,
                window.innerHeight - viewport.height - viewport.offsetTop
            );

            document.documentElement.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
        };

        applyKeyboardViewportOffset();

        if (viewport) {
            viewport.addEventListener('resize', applyKeyboardViewportOffset);
            viewport.addEventListener('scroll', applyKeyboardViewportOffset);
        }

        const cleanup = listenToKeyboard(
            () => {
                applyKeyboardViewportOffset();
            },
            () => {
                document.documentElement.style.setProperty('--keyboard-offset', '0px');
            }
        );

        return () => {
            cleanup();
            document.documentElement.style.setProperty('--keyboard-offset', '0px');
            if (viewport) {
                viewport.removeEventListener('resize', applyKeyboardViewportOffset);
                viewport.removeEventListener('scroll', applyKeyboardViewportOffset);
            }
        };
    }, []);

    // NOTE:
    // Do not force the whole app back to top when the native keyboard opens.
    // That causes the entire header/content area to jump upward and makes the
    // keyboard feel like it is pushing the whole screen rather than only the focused input area.
    // We keep the viewport anchored and use a keyboard-offset CSS variable for the composer area.
    const keyboardAwareMainStyles = {
        overflow: 'hidden',
        paddingBottom: 'var(--keyboard-offset, 0px)',
    } as React.CSSProperties;

    // Keep the app shell anchored and only shift the composer/input section when the keyboard is open.
    // This prevents the whole header/content area from being pushed upward by the native keyboard.
