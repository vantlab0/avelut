    useEffect(() => {
        const resetWindowScroll = () => {
            if (window.scrollY !== 0 || window.scrollX !== 0) {
                window.scrollTo(0, 0);
            }
            if (document.documentElement.scrollTop !== 0) {
                document.documentElement.scrollTop = 0;
            }
            if (document.body.scrollTop !== 0) {
                document.body.scrollTop = 0;
            }
            if (mainRef.current && mainRef.current.scrollTop !== 0) {
                mainRef.current.scrollTop = 0;
            }
        };

        window.addEventListener('scroll', resetWindowScroll, { passive: false });
        return () => window.removeEventListener('scroll', resetWindowScroll);
    }, [mainRef]);

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;
        const viewport = (window as any).visualViewport;
        const applyKeyboardViewportOffset = () => {
            if (!viewport) return;
            const keyboardOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
            document.documentElement.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
        };

        if (viewport) {
            viewport.addEventListener('resize', applyKeyboardViewportOffset);
            viewport.addEventListener('scroll', applyKeyboardViewportOffset);
            applyKeyboardViewportOffset();
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
    }, [mainRef]);

    // NOTE:
    // Do not force the whole app back to top when the native keyboard opens.
    // That causes the entire header/content area to jump upward and makes the
    // keyboard feel like it is pushing the whole screen rather than only the focused input area.
    // We keep the viewport anchored and use a keyboard-offset CSS variable for the composer area.
    const keyboardAwareMainStyles = {
        overflow: 'hidden',
        paddingBottom: 'var(--keyboard-offset, 0px)',
    } as React.CSSProperties;

    // ... keep the existing app layout, but use keyboardAwareMainStyles on the main wrapper
    // so the composer/input area can move while the app chrome remains stable.

    // Remove the old scroll reset block above and keep only the keyboard offset effect.

    // The root application container already uses fixed full-viewport layout; the keyboard should not
    // trigger a global window scroll on the entire application shell.
