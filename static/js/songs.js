(() => {
    const body = document.body;
    const audio = document.getElementById("main-audio");
    const searchInput = document.getElementById("search-input");
    const clearSearchButton = document.getElementById("clear-search");
    const songsContainer = document.getElementById("songs-container");
    const jumpGrid = document.getElementById("jump-grid");
    const librarySongs = document.getElementById("library-songs");
    const searchResultsSection = document.getElementById("search-results-section");
    const searchResults = document.getElementById("search-results");
    const homeScreen = document.getElementById("home-screen");
    const libraryScreen = document.getElementById("library-screen");
    const playerScreen = document.getElementById("player-screen");
    const featuredArtwork = document.getElementById("featured-artwork");
    const featuredTitle = document.getElementById("featured-title");
    const featuredArtist = document.getElementById("featured-artist");
    const featuredPlay = document.getElementById("featured-play");
    const featuredIndex = document.querySelector(".featured-index");
    const featuredPrevious = document.getElementById("featured-previous");
    const featuredNext = document.getElementById("featured-next");
    const detailTitle = document.getElementById("detail-title");
    const detailArtist = document.getElementById("detail-artist");
    const detailAlbum = document.getElementById("detail-album");
    const detailGenre = document.getElementById("detail-genre");
    const detailYear = document.getElementById("detail-year");
    const detailDuration = document.getElementById("detail-duration");
    const trackFacts = document.getElementById("track-facts");
    const playbackStatus = document.getElementById("playback-status");
    const consoleStatus = document.getElementById("console-status");
    const detailPlayButton = document.getElementById("detail-play-button");
    const playPauseButton = document.getElementById("play-pause-button");
    const favoriteButton = document.getElementById("favorite-button");
    const miniFavoriteButton = document.getElementById("mini-favorite-button");
    const queueButton = document.getElementById("queue-button");
    const moreFromArtist = document.getElementById("more-from-artist");
    const pageHeading = document.getElementById("page-heading");
    const headerEyebrow = document.getElementById("header-eyebrow");
    const progressInputs = [...document.querySelectorAll("[data-progress]")];
    const timeDisplays = [...document.querySelectorAll("[data-current-time]")];
    const durationDisplays = [...document.querySelectorAll("[data-duration]")];
    const profileDialog = document.getElementById("profile-dialog");

    let songs = [];
    let currentSongIndex = -1;
    let featuredSongIndex = 0;
    let queue = [];
    let screen = body.dataset.screen === "player" ? "player" : "home";
    let searchTimer;
    let favorites = readFavorites();

    function readFavorites() {
        try {
            const value = JSON.parse(localStorage.getItem("smoothplays:favorites") || "[]");
            return new Set(Array.isArray(value) ? value.filter((key) => typeof key === "string") : []);
        } catch (error) {
            console.warn("Unable to read saved SmoothPlays tracks:", error);
            return new Set();
        }
    }

    function songKey(song) {
        return `${song.source}:${song.id}`;
    }

    function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
    }

    function setStatus(message, kind = "ready") {
        playbackStatus.textContent = message;
        playbackStatus.classList.toggle("is-playing", kind === "playing");
        playbackStatus.classList.toggle("is-error", kind === "error");
        consoleStatus.textContent = message;
    }

    function imageElement(url, alt) {
        if (typeof url !== "string" || !url.trim()) return null;
        const image = document.createElement("img");
        image.alt = alt;
        image.loading = "lazy";
        image.decoding = "async";
        image.addEventListener("error", () => image.remove(), { once: true });
        image.src = url;
        return image;
    }

    function setArtwork(container, url, alt) {
        container.replaceChildren();
        const image = imageElement(url, alt);
        if (image) container.append(image);
    }

    function normalizeSong(song, source) {
        const originalAudioUrl = source === "local" ? song.file_path : song.audio;
        const audioUrl = source === "local" &&
            typeof originalAudioUrl === "string" &&
            !/^(?:https?:|blob:|data:)/i.test(originalAudioUrl)
            ? `/${originalAudioUrl.replace(/^\/+/, "")}`
            : originalAudioUrl;
        return {
            ...song,
            source,
            id: String(song.id ?? ""),
            title: typeof song.title === "string" && song.title.trim() ? song.title.trim() : "Untitled track",
            artist: typeof song.artist === "string" && song.artist.trim() ? song.artist.trim() : "Unknown artist",
            album: typeof song.album === "string" ? song.album.trim() : "",
            genre: typeof song.genre === "string" ? song.genre.trim() : "",
            year: typeof song.year === "string" || typeof song.year === "number" ? String(song.year).slice(0, 4) : "",
            image: typeof song.image === "string" ? song.image : "",
            audio: typeof audioUrl === "string" ? audioUrl : "",
            duration: Number.isFinite(Number(song.duration)) ? Number(song.duration) : null,
        };
    }

    async function fetchSource(url, source) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${source} catalog returned ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) {
            const detail = data && typeof data.error === "string" ? `: ${data.error}` : "";
            throw new Error(`${source} catalog response was invalid${detail}`);
        }
        return data.map((song) => normalizeSong(song, source));
    }

    function deduplicateTracks(tracks) {
        const sorted = tracks.sort((left, right) => {
            const priority = { local: 0, jamendo: 1, audius: 2 };
            return priority[left.source] - priority[right.source];
        });
        const seen = new Set();
        return sorted.filter((song) => {
            const identity = `${song.title.toLocaleLowerCase()}|${song.artist.toLocaleLowerCase()}`;
            if (seen.has(identity)) return false;
            seen.add(identity);
            return Boolean(song.id);
        });
    }

    function createSongCard(song, index) {
        const card = document.createElement("article");
        card.className = "song-card";
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "song-card-button";
        openButton.setAttribute("aria-label", `Open ${song.title} by ${song.artist}`);
        openButton.addEventListener("click", () => openPlayer(index));

        const art = document.createElement("div");
        art.className = "song-art artwork-placeholder";
        const image = imageElement(song.image, `Artwork for ${song.title}`);
        if (image) art.append(image);

        const meta = document.createElement("div");
        meta.className = "song-meta";
        const title = document.createElement("strong");
        title.textContent = song.title;
        const artist = document.createElement("span");
        artist.textContent = song.artist;
        meta.append(title, artist);
        openButton.append(art, meta);

        const playButton = document.createElement("button");
        playButton.type = "button";
        playButton.className = "song-play-button";
        playButton.textContent = "▶";
        playButton.setAttribute("aria-label", `Play ${song.title}`);
        playButton.addEventListener("click", () => openPlayer(index));
        card.append(openButton, playButton);
        return card;
    }

    function createJumpCard(song, index) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "jump-card";
        card.setAttribute("aria-label", `Play ${song.title} by ${song.artist}`);
        card.addEventListener("click", () => openPlayer(index));

        const art = document.createElement("div");
        art.className = "jump-art artwork-placeholder";
        const image = imageElement(song.image, `Artwork for ${song.title}`);
        if (image) art.append(image);
        const meta = document.createElement("span");
        meta.className = "jump-meta";
        const title = document.createElement("strong");
        title.textContent = song.title;
        const artist = document.createElement("span");
        artist.textContent = song.artist;
        meta.append(title, artist);
        const play = document.createElement("span");
        play.className = "jump-play";
        play.setAttribute("aria-hidden", "true");
        play.textContent = "▶";
        card.append(art, meta, play);
        return card;
    }

    function renderTrackList(container, tracks) {
        container.replaceChildren();
        if (tracks.length === 0) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "No tracks to show yet. Try another search or check back later.";
            container.append(empty);
            return;
        }

        tracks.forEach((song) => {
            const index = songs.indexOf(song);
            container.append(createSongCard(song, index));
        });
    }

    function renderHome() {
        if (songs.length === 0) return;
        const featuredCount = Math.min(songs.length, 5);
        featuredSongIndex %= featuredCount;
        const featured = songs[featuredSongIndex];
        featuredTitle.textContent = featured.title;
        featuredArtist.textContent = `${featured.artist}${featured.album ? ` · ${featured.album}` : ""}`;
        featuredPlay.disabled = false;
        setArtwork(featuredArtwork, featured.image, `Artwork for ${featured.title}`);
        featuredIndex.textContent = `${String(featuredSongIndex + 1).padStart(2, "0")} / ${String(featuredCount).padStart(2, "0")}`;
        featuredPrevious.disabled = featuredCount < 2;
        featuredNext.disabled = featuredCount < 2;

        jumpGrid.replaceChildren();
        songs.slice(0, 4).forEach((song) => {
            jumpGrid.append(createJumpCard(song, songs.indexOf(song)));
        });
        renderTrackList(songsContainer, songs.slice(4, 12));
    }

    function searchRank(song, terms) {
        const title = song.title.toLocaleLowerCase();
        const artist = song.artist.toLocaleLowerCase();
        const all = `${title} ${artist} ${song.album} ${song.genre}`.toLocaleLowerCase();
        if (!terms.every((term) => all.includes(term))) return -1;
        if (title === terms.join(" ")) return 0;
        if (title.startsWith(terms.join(" "))) return 1;
        if (title.includes(terms.join(" "))) return 2;
        if (artist === terms.join(" ")) return 3;
        if (artist.includes(terms.join(" "))) return 4;
        return 5;
    }

    function renderSearch() {
        const query = searchInput.value.trim().toLocaleLowerCase();
        clearSearchButton.classList.toggle("hidden", query.length === 0);
        const searching = screen === "search" || query.length > 0;
        searchResultsSection.hidden = !searching;
        const homeSections = [...homeScreen.querySelectorAll(".featured-section, .home-screen > .tracks-section")];
        homeSections.forEach((section) => {
            if (section !== searchResultsSection) section.hidden = searching;
        });
        if (!searching) return;

        const terms = query.split(/\s+/).filter(Boolean);
        if (terms.length === 0) {
            searchResults.replaceChildren();
            const message = document.createElement("p");
            message.className = "empty-state";
            message.textContent = "Search by song title, artist, album, or genre.";
            searchResults.append(message);
            return;
        }
        const results = songs
            .map((song) => ({ song, rank: searchRank(song, terms) }))
            .filter((entry) => entry.rank >= 0)
            .sort((left, right) => left.rank - right.rank)
            .map((entry) => entry.song);
        renderTrackList(searchResults, results);
        document.getElementById("search-results-heading").textContent =
            results.length === 1 ? "1 result" : `${results.length} results`;
    }

    function renderLibrary() {
        renderTrackList(librarySongs, songs.filter((song) => favorites.has(songKey(song))));
    }

    function syncFavoriteButtons() {
        const song = songs[currentSongIndex];
        const liked = Boolean(song && favorites.has(songKey(song)));
        for (const button of [favoriteButton, miniFavoriteButton]) {
            button.setAttribute("aria-pressed", String(liked));
            button.setAttribute("aria-label", liked ? "Remove from liked songs" : "Like track");
        }
        favoriteButton.querySelector("span:last-child").textContent = liked ? "Liked" : "Like";
    }

    function toggleFavorite() {
        const song = songs[currentSongIndex];
        if (!song) return;
        const key = songKey(song);
        if (favorites.has(key)) favorites.delete(key);
        else favorites.add(key);
        try {
            localStorage.setItem("smoothplays:favorites", JSON.stringify([...favorites]));
            syncFavoriteButtons();
            renderLibrary();
            if (screen === "library") {
                document.getElementById("library-heading").textContent = "Liked Songs";
            }
        } catch (error) {
            console.error("Unable to save liked tracks:", error);
            setStatus("Could not save your liked tracks in this browser.", "error");
        }
    }

    function updatePlayButtons() {
        const playing = !audio.paused && !audio.ended;
        for (const button of [playPauseButton, detailPlayButton]) {
            button.textContent = playing ? "Ⅱ" : "▶";
            button.setAttribute("aria-label", playing ? "Pause track" : "Play track");
            button.disabled = currentSongIndex < 0 || !songs[currentSongIndex]?.audio;
        }
    }

    function updateProgress() {
        const duration = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : songs[currentSongIndex]?.duration;
        const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const percentage = Number.isFinite(duration) && duration > 0
            ? Math.min(100, (currentTime / duration) * 100)
            : 0;
        progressInputs.forEach((input) => {
            input.value = String(percentage);
            input.disabled = currentSongIndex < 0 || !Number.isFinite(audio.duration) || audio.duration <= 0;
        });
        timeDisplays.forEach((display) => {
            display.textContent = formatTime(currentTime);
        });
        durationDisplays.forEach((display) => {
            display.textContent = Number.isFinite(duration) && duration > 0 ? formatTime(duration) : "--:--";
        });
    }

    function renderMoreFromArtist(song) {
        moreFromArtist.replaceChildren();
        const byArtist = songs.filter((candidate, index) =>
            index !== currentSongIndex &&
            candidate.artist.toLocaleLowerCase() === song.artist.toLocaleLowerCase()
        );
        const similar = byArtist.length > 0
            ? byArtist
            : songs.filter((candidate, index) =>
                index !== currentSongIndex &&
                song.genre &&
                candidate.genre.toLocaleLowerCase() === song.genre.toLocaleLowerCase()
            );
        const heading = document.getElementById("more-heading");
        heading.textContent = byArtist.length > 0 ? `More from ${song.artist}` : "More like this";
        if (similar.length === 0) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "There aren’t any similar tracks in the available catalog yet.";
            moreFromArtist.append(empty);
            return;
        }

        similar.slice(0, 4).forEach((track) => {
            const index = songs.indexOf(track);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "more-card";
            button.setAttribute("aria-label", `Play ${track.title} by ${track.artist}`);
            button.addEventListener("click", () => openPlayer(index));
            const art = document.createElement("div");
            art.className = "more-art";
            const image = imageElement(track.image, `Artwork for ${track.title}`);
            if (image) art.append(image);
            const meta = document.createElement("span");
            meta.className = "more-meta";
            const title = document.createElement("strong");
            title.textContent = track.title;
            const artist = document.createElement("span");
            artist.textContent = track.artist;
            meta.append(title, artist);
            const play = document.createElement("span");
            play.setAttribute("aria-hidden", "true");
            play.textContent = "▶";
            button.append(art, meta, play);
            moreFromArtist.append(button);
        });
    }

    function updateTrackDetails(song) {
        detailTitle.textContent = song.title;
        detailArtist.textContent = song.artist;
        document.getElementById("player-title").textContent = song.title;
        document.getElementById("player-artist").textContent = song.artist;
        document.title = `${song.title} · SmoothPlays`;

        const detailArtContainer = document.getElementById("detail-artwork");
        const image = imageElement(song.image, `Artwork for ${song.title}`);
        detailArtContainer.replaceChildren();
        if (image) detailArtContainer.append(image);

        const playerArt = document.getElementById("player-artwork");
        const playerImage = imageElement(song.image, `Artwork for ${song.title}`);
        playerArt.replaceChildren();
        if (playerImage) playerArt.append(playerImage);

        const facts = [
            [detailAlbum, song.album],
            [detailGenre, song.genre],
            [detailYear, song.year],
            [detailDuration, song.duration ? formatTime(song.duration) : ""],
        ];
        let visibleFacts = 0;
        facts.forEach(([element, value]) => {
            element.textContent = value ? String(value) : "";
            element.hidden = !value;
            if (value) visibleFacts += 1;
        });
        trackFacts.hidden = visibleFacts === 0;
        favoriteButton.disabled = false;
        queueButton.disabled = false;
        renderMoreFromArtist(song);
        syncFavoriteButtons();
    }

    async function playCurrentTrack() {
        const song = songs[currentSongIndex];
        if (!song) {
            setStatus("Choose a track to start listening.");
            return;
        }
        if (!song.audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            updatePlayButtons();
            updateProgress();
            setStatus("Audio is not available for this track.", "error");
            return;
        }
        if (audio.paused) {
            setStatus("Loading audio…");
            try {
                await audio.play();
            } catch (error) {
                console.error("Unable to start playback:", error);
                setStatus("This track couldn’t be played. Try another track.", "error");
            }
        } else {
            audio.pause();
        }
        updatePlayButtons();
    }

    async function selectSong(index, autoplay = true) {
        if (index < 0 || index >= songs.length) return;
        const song = songs[index];
        const target = `/player/${encodeURIComponent(song.source)}/${encodeURIComponent(song.id)}`;
        if (screen === "player" && window.location.pathname !== target) {
            window.history.pushState({ smoothplays: true, smoothplaysInternal: true }, "", target);
        }
        const sameSong = currentSongIndex === index;
        currentSongIndex = index;
        updateTrackDetails(song);
        updatePlayButtons();
        updateProgress();
        if (!song.audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            updatePlayButtons();
            updateProgress();
            setStatus("Audio is not available for this track.", "error");
            return;
        }
        if (!sameSong || audio.src !== new URL(song.audio, window.location.href).href) {
            audio.src = song.audio;
            audio.load();
            if (autoplay) setStatus("Loading audio…");
        }
        if (autoplay && sameSong && !audio.paused) setStatus("Playing", "playing");
        else if (autoplay) await playCurrentTrack();
        else setStatus("Ready to play");
    }

    function setScreen(nextScreen) {
        screen = nextScreen;
        body.dataset.screen = nextScreen === "player" ? "player" : "home";
        homeScreen.hidden = nextScreen !== "home" && nextScreen !== "search";
        libraryScreen.hidden = nextScreen !== "library";
        playerScreen.hidden = nextScreen !== "player";
        const headings = {
            home: ["YOUR SOUND, YOUR WAY", "Find your next favorite"],
            search: ["EXPLORE THE CATALOG", "Search SmoothPlays"],
            library: ["YOUR COLLECTION", "Your library"],
            player: ["NOW PLAYING", "Now playing"],
        };
        headerEyebrow.textContent = headings[nextScreen][0];
        pageHeading.textContent = headings[nextScreen][1];
        document.querySelectorAll("[data-nav]").forEach((button) => {
            const active = button.dataset.nav === (nextScreen === "search" ? "search" : nextScreen === "library" ? "library" : "home");
            button.classList.toggle("active", active);
            if (button.classList.contains("bottom-link")) {
                if (active) button.setAttribute("aria-current", "page");
                else button.removeAttribute("aria-current");
            }
        });
        if (nextScreen === "library") renderLibrary();
        if (nextScreen === "search") {
            renderSearch();
            searchInput.focus({ preventScroll: true });
        } else {
            renderSearch();
        }
    }

    function openPlayer(index) {
        if (index < 0 || index >= songs.length) return;
        setScreen("player");
        selectSong(index, true);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function openFromCurrentLocation(autoplay = false) {
        const match = window.location.pathname.match(/^\/player\/(jamendo|audius|local)\/([^/]+)\/?$/);
        if (!match) {
            setScreen("home");
            return;
        }
        const source = decodeURIComponent(match[1]);
        const id = decodeURIComponent(match[2]);
        const index = songs.findIndex((song) => song.source === source && song.id === id);
        setScreen("player");
        if (index < 0) {
            detailTitle.textContent = "Track unavailable";
            detailArtist.textContent = "This track could not be found in the current catalog.";
            document.getElementById("player-title").textContent = "Track unavailable";
            document.getElementById("player-artist").textContent = "Return to the catalog to choose another track.";
            detailPlayButton.disabled = true;
            favoriteButton.disabled = true;
            queueButton.disabled = true;
            setStatus("This track is no longer available.", "error");
            return;
        }
        selectSong(index, autoplay);
    }

    function updateNavForLibrary() {
        document.querySelectorAll("[data-nav='library']").forEach((button) => {
            button.classList.add("active");
        });
    }

    document.querySelectorAll("[data-nav]").forEach((button) => {
        button.addEventListener("click", () => {
            const target = button.dataset.nav;
            if (target === "library") {
                if (screen === "player") {
                    window.history.pushState({ smoothplays: true, smoothplaysInternal: true, screen: "library" }, "", "/");
                }
                setScreen("library");
                updateNavForLibrary();
            } else if (target === "search") {
                setScreen("search");
            } else {
                if (window.location.pathname !== "/") {
                    window.history.pushState({ smoothplays: true, smoothplaysInternal: true, screen: "home" }, "", "/");
                }
                setScreen("home");
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        });
    });

    for (const button of document.querySelectorAll("[data-profile]")) {
        button.addEventListener("click", () => profileDialog.showModal());
    }
    document.querySelector(".dialog-close").addEventListener("click", () => profileDialog.close());
    document.querySelector(".dialog-dismiss").addEventListener("click", () => profileDialog.close());
    profileDialog.addEventListener("click", (event) => {
        if (event.target === profileDialog) profileDialog.close();
    });

    document.getElementById("back-button").addEventListener("click", () => {
        const sameOriginReferrer = document.referrer && new URL(document.referrer).origin === window.location.origin;
        if (window.history.state?.smoothplaysInternal || sameOriginReferrer) window.history.back();
        else window.location.assign("/");
    });
    document.getElementById("forward-button").addEventListener("click", () => window.history.forward());

    searchInput.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(renderSearch, 130);
    });
    clearSearchButton.addEventListener("click", () => {
        searchInput.value = "";
        renderSearch();
        searchInput.focus();
    });

    featuredPlay.addEventListener("click", () => {
        if (songs.length > 0) openPlayer(featuredSongIndex);
    });
    featuredPrevious.addEventListener("click", () => {
        const count = Math.min(songs.length, 5);
        if (count < 2) return;
        featuredSongIndex = (featuredSongIndex - 1 + count) % count;
        renderHome();
    });
    featuredNext.addEventListener("click", () => {
        const count = Math.min(songs.length, 5);
        if (count < 2) return;
        featuredSongIndex = (featuredSongIndex + 1) % count;
        renderHome();
    });
    playPauseButton.addEventListener("click", playCurrentTrack);
    detailPlayButton.addEventListener("click", playCurrentTrack);
    document.querySelectorAll("[data-previous]").forEach((button) => {
        button.addEventListener("click", () => {
            if (songs.length === 0 || currentSongIndex < 0) return;
            if (audio.currentTime > 3) {
                audio.currentTime = 0;
                return;
            }
            const index = (currentSongIndex - 1 + songs.length) % songs.length;
            selectSong(index);
        });
    });
    document.querySelectorAll("[data-next]").forEach((button) => {
        button.addEventListener("click", () => {
            const queuedIndex = queue.shift();
            if (queuedIndex !== undefined && songs[queuedIndex]) {
                selectSong(queuedIndex);
                return;
            }
            if (songs.length === 0) return;
            selectSong((currentSongIndex + 1 + songs.length) % songs.length);
        });
    });
    favoriteButton.addEventListener("click", toggleFavorite);
    miniFavoriteButton.addEventListener("click", toggleFavorite);
    queueButton.addEventListener("click", () => {
        if (currentSongIndex < 0) return;
        queue.push(currentSongIndex);
        setStatus(`${queue.length} ${queue.length === 1 ? "track" : "tracks"} in queue.`);
    });
    progressInputs.forEach((input) => {
        input.addEventListener("input", () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                audio.currentTime = (Number(input.value) / 100) * audio.duration;
            }
        });
    });

    audio.addEventListener("timeupdate", updateProgress);
    audio.addEventListener("loadedmetadata", updateProgress);
    audio.addEventListener("play", () => {
        updatePlayButtons();
        setStatus("Playing", "playing");
    });
    audio.addEventListener("pause", () => {
        updatePlayButtons();
        if (currentSongIndex >= 0 && songs[currentSongIndex]?.audio && !audio.ended) setStatus("Paused");
    });
    audio.addEventListener("ended", () => {
        updatePlayButtons();
        const queuedIndex = queue.shift();
        if (queuedIndex !== undefined && songs[queuedIndex]) selectSong(queuedIndex);
        else if (songs.length > 0) selectSong((currentSongIndex + 1) % songs.length);
    });
    audio.addEventListener("error", () => {
        if (currentSongIndex >= 0 && songs[currentSongIndex]?.audio) {
            setStatus("This track couldn’t be played. Try another track.", "error");
        }
        updatePlayButtons();
    });
    window.addEventListener("popstate", () => {
        openFromCurrentLocation(currentSongIndex >= 0 && !audio.paused);
    });

    async function loadCatalog() {
        songsContainer.innerHTML = '<p class="empty-state">Loading music…</p>';
        jumpGrid.innerHTML = '<p class="empty-state">Loading the catalog…</p>';
        const sources = [
            fetchSource("/api/songs", "local"),
            fetchSource("/api/jamendo/songs", "jamendo"),
            fetchSource("/api/audius/songs", "audius"),
        ];
        const results = await Promise.allSettled(sources);
        const successful = results.filter((result) => result.status === "fulfilled");
        const failures = results.filter((result) => result.status === "rejected");
        failures.forEach((result) => console.error("Catalog source unavailable:", result.reason));
        songs = deduplicateTracks(successful.flatMap((result) => result.value));

        if (songs.length === 0) {
            const message = failures.length === results.length
                ? "Music is temporarily unavailable. Please try again later."
                : "No tracks are available in the catalog yet.";
            for (const container of [songsContainer, jumpGrid]) {
                const empty = document.createElement("p");
                empty.className = "empty-state";
                empty.textContent = message;
                container.replaceChildren(empty);
            }
            featuredTitle.textContent = "Music will find its way";
            featuredArtist.textContent = "There are no tracks available right now.";
            const routeIsPlayer = body.dataset.screen === "player";
            if (routeIsPlayer) openFromCurrentLocation(false);
            return;
        }

        renderHome();
        renderLibrary();
        if (screen === "player" || body.dataset.screen === "player") {
            openFromCurrentLocation(false);
        }
        renderSearch();
    }

    window.history.replaceState(
        { ...(window.history.state || {}), smoothplays: true, smoothplaysInternal: false },
        "",
        window.location.href
    );
    setScreen(screen);
    updatePlayButtons();
    updateProgress();
    setStatus("Ready");
    loadCatalog().catch((error) => {
        console.error("Unable to load the music catalog:", error);
        songsContainer.textContent = "Music is temporarily unavailable. Please try again later.";
        jumpGrid.replaceChildren();
    });
})();
