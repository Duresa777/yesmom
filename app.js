import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, serverTimestamp, setDoc, doc, getDocs, getDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDNz9QNToU5WR2dQKQvgP6mXpX63yccfAk",
    authDomain: "yesmom-3d17a.firebaseapp.com",
    projectId: "yesmom-3d17a",
    storageBucket: "yesmom-3d17a.firebasestorage.app",
    messagingSenderId: "663992748055",
    appId: "1:663992748055:web:501485baf19e72f854f452",
    measurementId: "G-57XTMGP0MV"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let currentUser = "";
let currentUserUid = "";
let mediaRecorder;
let audioChunks = [];
let audioBlob = null;
let unsubscribeMessages = null;

// UI Elements
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const googleLoginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const talkBtn = document.getElementById('talk-btn');
const statusText = document.getElementById('status-text');
const recipientModal = document.getElementById('recipient-modal');
const cancelBtn = document.getElementById('cancel-btn');
const userGreeting = document.getElementById('user-greeting');
const searchInput = document.getElementById('user-search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');
const savedContacts = document.getElementById('saved-contacts');

// 1. Authentication State Listener
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user.email;
        currentUserUid = user.uid;
        const firstName = user.displayName?.split(" ")[0] || user.email?.split("@")[0] || "User";
        userGreeting.innerText = `Hi, ${firstName}`;

        try {
            const userRef = doc(db, "users", user.uid);
            await setDoc(userRef, {
                uid: user.uid,
                name: user.displayName || firstName,
                searchName: (user.displayName || firstName).toLowerCase(),
                email: user.email
            }, { merge: true });
        } catch (error) {
            console.error("Could not save user profile:", error);
            statusText.innerText = "Could not update your family profile.";
        }

        loginScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');

        await requestMicrophone();
        listenForMessages();
        await loadContacts();
    } else {
        currentUser = "";
        currentUserUid = "";
        loginScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
        savedContacts.innerHTML = '';
        searchResults.innerHTML = '';
        searchInput.value = '';
        if (unsubscribeMessages) {
            unsubscribeMessages();
            unsubscribeMessages = null;
        }
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
        mediaRecorder?.stream.getTracks().forEach(track => track.stop());
        mediaRecorder = null;
    }
});

// 2. Login / Logout Triggers
googleLoginBtn.addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(error => {
        console.error("Login failed:", error);
        alert("Could not sign in with Google.");
    });
});

logoutBtn.addEventListener('click', () => {
    signOut(auth).catch(error => console.error("Logout failed:", error));
});

// 3. Microphone Setup
async function requestMicrophone() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];
            talkBtn.classList.add('hidden');
            recipientModal.classList.remove('hidden');
            statusText.innerText = "Select recipient";
        };
    } catch (err) {
        alert("Microphone access is required to use YesMom!");
        console.error(err);
    }
}

// 4. Handle Recording (Pointer Events)
talkBtn.addEventListener('pointerdown', () => {
    if (!mediaRecorder || mediaRecorder.state !== "inactive") return;
    talkBtn.classList.add('recording');
    statusText.innerText = "Recording...";
    audioChunks = [];
    mediaRecorder.start();
});

talkBtn.addEventListener('pointerup', () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    talkBtn.classList.remove('recording');
    mediaRecorder.stop();
});

talkBtn.addEventListener('pointercancel', () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    talkBtn.classList.remove('recording');
    mediaRecorder.stop();
});

// Cancel recording
cancelBtn.addEventListener('click', () => {
    audioBlob = null;
    recipientModal.classList.add('hidden');
    talkBtn.classList.remove('hidden');
    statusText.innerText = "Ready.";
});

// 5. Saved Contact Management
async function loadContacts() {
    if (!currentUserUid) return;

    try {
        const userRef = doc(db, "users", currentUserUid);
        const userSnapshot = await getDoc(userRef);
        const contacts = userSnapshot.exists() ? userSnapshot.data().contacts || [] : [];
        renderSavedContacts(contacts);
    } catch (error) {
        console.error("Could not load contacts:", error);
        savedContacts.innerHTML = '<p class="status-indicator" style="font-size:14px;margin-bottom:0;">Could not load contacts.</p>';
    }
}

function renderSavedContacts(contacts) {
    savedContacts.innerHTML = '';

    if (contacts.length === 0) {
        savedContacts.innerHTML = '<p class="status-indicator" style="font-size:14px;margin-bottom:0;">No contacts yet. Search below to add family.</p>';
        return;
    }

    contacts.forEach(contact => {
        const button = document.createElement('button');
        button.className = 'send-btn';
        button.innerText = contact.name;
        button.addEventListener('click', () => sendMessageTo(contact.email, contact.name));
        savedContacts.appendChild(button);
    });
}

// 6. Search for Users & Save Contacts
searchBtn.addEventListener('click', async () => {
    const term = searchInput.value.toLowerCase().trim();
    if (!term) return;

    searchResults.innerHTML = '<p class="status-indicator" style="margin-bottom:0;">Searching...</p>';

    try {
        const usersQuery = query(
            collection(db, "users"),
            where("searchName", ">=", term),
            where("searchName", "<=", term + '\uf8ff')
        );
        const snapshot = await getDocs(usersQuery);
        searchResults.innerHTML = '';

        const matchingUsers = snapshot.docs
            .map(userDoc => userDoc.data())
            .filter(userData => userData.email && userData.email !== currentUser);

        if (matchingUsers.length === 0) {
            searchResults.innerHTML = '<p class="status-indicator" style="margin-bottom:0;">No one found.</p>';
            return;
        }

        matchingUsers.forEach(userData => {
            const button = document.createElement('button');
            button.className = 'auth-btn';
            button.innerText = `+ Add ${userData.name || userData.email}`;
            button.addEventListener('click', async () => {
                button.innerText = "Adding...";
                button.disabled = true;

                try {
                    const userRef = doc(db, "users", currentUserUid);
                    await updateDoc(userRef, {
                        contacts: arrayUnion({
                            name: userData.name || userData.email,
                            email: userData.email
                        })
                    });

                    searchInput.value = '';
                    searchResults.innerHTML = '';
                    await loadContacts();
                } catch (error) {
                    console.error("Could not add contact:", error);
                    button.innerText = "Could not add. Try again.";
                    button.disabled = false;
                }
            });
            searchResults.appendChild(button);
        });
    } catch (error) {
        console.error("Error searching for users:", error);
        searchResults.innerHTML = '<p class="status-indicator" style="margin-bottom:0;">Search failed. Try again.</p>';
    }
});

searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') searchBtn.click();
});

function sendMessageTo(targetEmail, targetName) {
    if (!audioBlob) return;

    statusText.innerText = "Sending...";
    recipientModal.classList.add('hidden');

    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
        try {
            await addDoc(collection(db, "messages"), {
                senderName: userGreeting.innerText.replace("Hi, ", ""),
                recipient: targetEmail,
                audioUrl: reader.result,
                timestamp: serverTimestamp()
            });

            statusText.innerText = `Sent to ${targetName.split(" ")[0]}!`;
            setTimeout(() => statusText.innerText = "Ready.", 2000);
        } catch (error) {
            console.error("Error sending:", error);
            statusText.innerText = "Error sending message.";
        }

        talkBtn.classList.remove('hidden');
        audioBlob = null;
        searchResults.innerHTML = '';
        searchInput.value = '';
    };
}

// 7. Listen for Incoming Messages
function listenForMessages() {
    if (unsubscribeMessages) unsubscribeMessages();
    const q = query(collection(db, "messages"), where("recipient", "==", currentUser));
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            // Only trigger on NEW messages added while online
            if (change.type === "added") {
                const message = change.doc.data();
                
                // Don't play old messages on load (check timestamp)
                if (message.timestamp && message.timestamp.toMillis() > Date.now() - 5000) {
                    statusText.innerText = `Incoming from ${message.senderName}!`;
                    const audio = new Audio(message.audioUrl);
                    audio.play();
                    
                    audio.onended = () => {
                        statusText.innerText = "Ready.";
                    };
                }
            }
        });
    });
}
