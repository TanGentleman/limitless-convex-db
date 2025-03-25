# Python Integration with Convex

You can interact with the Convex backend using public functions. For instance, the `main.py` file utilizes the `sync` function from `convex-app/extras/hooks.ts` to keep up to date with the Limitless API.

## Prerequisites

Before you begin, ensure you have:

- Python 3.8+ installed
- A Convex project set up and deployed
- Your Convex deployment URL (follow steps in convex-app/README.md)

1. Create a virtual environment:
   ```bash
   cd convex-app/python-src
   python -m venv .venv
   ```

2. Activate the virtual environment:
   - On Windows:
     ```bash
     .venv\Scripts\activate
     ```
   - On macOS/Linux:
     ```bash
     source .venv/bin/activate
     ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
   
   Or install directly:
   ```bash
   pip install convex python-dotenv
   ```

## Configuration

1. Create a `.env` file in the root directory with your Convex URL:
   ```
   CONVEX_URL=your_convex_deployment_url
   ```

   You can find your deployment URL in the Convex dashboard.

## Running the Code

Execute the main script:
```bash
python main.py
```
