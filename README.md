Ciao ChatGPT, I need to send my CV to OpenaAI for Solutions Architect in Sidney, this is my resume information, but I need to enrich it with a couple of project that I made with AI:
1) Luna: An AI is often seen as a disembodied, intimidating "brain in a vat." 🧠💭 In my personal project, I explore AI embodiment by giving it a digital body—a multimodal friend 🤖 that expresses itself through a 3D avatar and a generative environment reacting to its thoughts. ✨ This exploration is, in my opinion, particularly relevant as humans are beginning to show empathy even towards artificial entities.

To achieve this, I designed a real-time architecture for multimodal conversation: ⚡️

- 3D Avatar & Lip-Sync 🗣️: I implemented the lip-sync by rendering a Ready Player Me avatar with Three.js and mapping the live audio amplitude from OpenAI's gpt-4o-realtime model directly to the avatar's facial morph targets. 🔊

- AI-Driven Generative Background 🎨: In parallel, I process the AI's text response with gpt-4o-mini to create an artistic visual prompt. I then use this prompt to update a Stream Diffusion pipeline 🎬. The video stream I engineered is ingested using WHIP (WebRTC-HTTP Ingestion Protocol) and distributed via WHEP (WebRTC-HTTP Egress Protocol), ensuring low-latency streaming. 🚀
The result is a synchronized experience I orchestrated, where the AI's voice animates its avatar while its words shape the visual environment. 🌌
I handled all backend logic and signaling using Node.js, Express, and Socket.io. ⚙️

Tech Stack 🛠️: Node.js, Three.js, OpenAI API (gpt-4o-realtime, gpt-4o-mini-transcribe, gpt-4o-mini), Livepeer, WebRTC (WHIP/WHEP), Socket.io.

hashtag#AI hashtag#Embodiment hashtag#ThreeJS hashtag#ReadyPlayerMe hashtag#WebRTC hashtag#OpenAI hashtag#GPT4o hashtag#Livepeer hashtag#StreamDiffusion hashtag#GenerativeAI hashtag#HCI

"Ciao, Luna." 👋🌙 
https://gigib.it/luna 🔗

Please note: As this is an exploratory project, please open it externally (not in LinkedIn), and allow a few seconds for the generative background to initialize. Meanwhile, feel free to start a conversation with Luna—it's a great way also to practice a new language!


2) inGoya: the purpose of this project is to create a social network with camera access or just a auto animated WebGL colourful canvas if users don't wanna let camera access, and let the people being WHO/WHATever they want using Stream Diffusion through webrtc stream input (camera, or canvas)

3) youre: a game where users has to find who is the AI before the others, so they have to seems AI and AI have to seem human (just a friendly prompt that seems to work for now), a user pay 1tkn and gain .8tkn for every partecipants if he wins




"Ciao, Luna." 👋🌙
https://gigib.it/luna 🔗



python generate.py \
  --task i2v-14B \
  --ckpt_dir ./Wan2.1-I2V-14B-720P \
  --image ./../test_inputs/a.jpg \
  --prompt  \
  --size 1280*720 \
  --save_file ./../outputs/a.mp4