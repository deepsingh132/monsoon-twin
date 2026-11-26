# Monsoon Twin

Monsoon Twin is a digital twin of the daily weather of India. It is our entry for Track 2, "Multiverse of Monsoon".

The twin uses the last 3 days of weather on a grid of 32 × 36 points. Each point is 1 degree wide. The twin calculates temperature, rain, wind, sea-level pressure and water vapour. It calculates 1 day at a time, for a maximum of 14 days. Each new day comes from the days before it.

You can also change the last day, for example make the Bay of Bengal 3 °C warmer. The twin then calculates a second "universe" with this change. The change starts near its area and moves out, step by step.

## Contents of the repository

| Item | Function |
|---|---|
| `serve.py` | The HTTP server. The organisers start it. It uses only `twin.py`. |
| `twin.py` | The model: the network, the long-term average, the day-by-day calculation and the output limits. |
| `weights/twin.pt` | The trained weights, the long-term average and the scales (13 MB). |
| `train.py` | The training procedure. |
| `mlx_twin.py` | A copy of the network for training on the Apple GPU. |
| `evaluate.py` | The local test with the scoring functions of the organisers. |
| `tests/` | The automatic tests. |
| `dashboard/` | A small map page. |
| `demo/` | The demo site: Forecast, Climate twin, Flood risk, How it works and Results. |
| `brief/` | The 2-page brief (`monsoon-twin-brief.pdf`) and its HTML source. To make the PDF again, open `brief.html` and print to PDF. |
| `docs/adr/` | The design decisions. |
| `challenges.md` | The problems that we had, and what we did. |

## How to start the server

The organisers use this procedure. The server needs no internet connection.

1. Install Python 3. We tested the server with Python 3.12.
2. Install the libraries:
   ```bash
   pip install torch numpy fastapi uvicorn
   ```
3. Go to the root folder of the repository.
4. Start the server:
   ```bash
   python serve.py --port 8000
   ```
5. Wait for the server to load the weights. This takes approximately 3 seconds.

The server listens on `0.0.0.0`. It loads `weights/twin.pt` before it answers. It does not write files next to the code.

The server has 2 routes:

- `POST /health` gives `{"status": "ready", "model_name": "monsoon-twin"}`.
- `POST /simulate` receives `{"init_states": [3,6,32,36], "doy_sincos": [sin, cos], "steps": 1..14, "perturbation": null | [6,32,36]}`. It gives `{"rollout": [steps,6,32,36], "inference_ms": ...}`.

All values are in physical units: K, mm/day, m/s, m/s, Pa and kg/m². The channels are in this sequence: `t2m`, `tp`, `u10`, `v10`, `msl`, `tcwv`.

**Note:** A request of 10 days takes 0.09 to 0.14 seconds on a laptop CPU. The limit of the organisers is 5 seconds.

## How to train the model

Training reads the data file of the organisers. The default location is `../yug-monsoon-kit-main/release/india_climate_train.nc`, next to this repository. To use a different location, add `--data <path>`.

**Caution:** Do not copy the data file into this repository. The repository scan of the organisers gives a warning for climate data files.

**Note:** Training uses [MLX](https://github.com/ml-explore/mlx) (open source, MIT) on the GPU of an Apple Silicon computer. Thus, training needs a Mac with an Apple Silicon chip. The server does not need a Mac. The training procedure saves the weights as a PyTorch file, and the server reads this file on any CPU.

1. Make a Python environment:
   ```bash
   python -m venv .venv && source .venv/bin/activate
   ```
2. Install the libraries:
   ```bash
   pip install mlx torch numpy xarray netCDF4 fastapi uvicorn httpx pytest
   ```
3. Install the kit of the organisers. `evaluate.py` and the tests use it:
   ```bash
   pip install ../yug-monsoon-kit-main/release/monsoon_r1_kit-1.0.0-py3-none-any.whl
   ```
4. Train the development model on 2005 to 2017. Show the loss on 2018 and 2019:
   ```bash
   python train.py --years 2005-2017 --val-years 2018-2019 --out /tmp/dev.pt
   ```
5. Set the heavy-rain limits of the development model on 2018 and 2019:
   ```bash
   python train.py --tune-rain /tmp/dev.pt --val-years 2018-2019 --out /tmp/dev.pt
   ```
6. Train the final model on all years, 2005 to 2021. Use the heavy-rain limits from step 5:
   ```bash
   python train.py --years 2005-2021 --rain-cut-from /tmp/dev.pt
   ```

Step 6 writes `weights/twin.pt`. Each training run takes approximately 19 minutes.

**Note:** `mlx_twin.py` is a copy of the network in `twin.py`, layer for layer. A test makes sure that the 2 copies give the same forecast.

## How to test the model

1. Run the automatic tests:
   ```bash
   pytest
   ```
2. Start the server:
   ```bash
   python serve.py --port 8000 &
   ```
3. Run the schema test of the organisers:
   ```bash
   python -m monsoon_r1.schema_validator http://localhost:8000
   ```
4. Make sure that the schema test shows "all checks passed".

## How to score the model

Run `evaluate.py` on a weights file:

```bash
python evaluate.py /tmp/dev.pt --years 2018 2019 --baseline --dynamics --events
```

`evaluate.py` uses the scoring functions of the organisers. It calculates:

- the forecast skill and the heavy-rain skill on days 1, 4 and 8, against the better of "repeat yesterday" and the long-term average;
- the detail of the forecast on day 8 (no blur);
- the limits for 14 days;
- the zero shock;
- 3 shocks: a warmer Bay of Bengal, a weaker Arabian Sea wind and an Arabian Sea 2.5 °C warmer;
- windows that are similar to the 5 hidden test windows.

The organisers do not tell how they calculate the average of the windows. Thus, `evaluate.py` gives the skill in 3 ways. [GLOSSARY.md](GLOSSARY.md) tells the 3 ways.

## How to use the demo

The demo is a website in `demo/`. Each forecast comes from the server at the time of the request. The demo does not show saved results.

1. Start the server:
   ```bash
   python serve.py --port 8000 &
   ```
2. Start the website:
   ```bash
   python demo/serve_demo.py --port 5173 --twin http://127.0.0.1:8000
   ```
3. Open http://localhost:5173 in a web browser.

The demo has 5 pages:

- **Forecast** (`index.html`) shows the twin forecast and the real weather side by side. The panel shows the skill of each day. The skill uses the method of the kit of the organisers.
- **Climate twin** (`twin.html`) shows 2 universes from the same 3 real days. Universe A is as it was. Universe B has a change to the last day. You can select a change of the organisers, or make your own change: a region, a field and an amount. A change of 0 does not change the forecast.
- **Flood risk** (`flood.html`) is the digital twin. Two copies of the weather start from the same real days and evolve one day per live `/simulate` call, for up to 10 days: **Before** without a change, **After** with the changes you apply at any day. Press → to calculate the next day and ← to go back. Each day shows the people and the states at flood risk, before and after.
- **How it works** (`how.html`) tells how the twin and the pages work.
- **Results** (`results.html`) shows the test results.

The small map page in `dashboard/` also uses the server. To use it, start the server and open `dashboard/index.html`.

**Note:** The demo works without an internet connection. All libraries and maps are in `demo/`.

### Data and licences of the demo

- [Leaflet](https://leafletjs.com) (BSD-2) and [leaflet-velocity](https://github.com/onaci/leaflet-velocity) (CSIRO BSD/MIT-style) are in `demo/vendor/`, with their licences.
- The borders of India, its states and union territories come from the [DataMeet India community](https://github.com/datameet/maps) (CC BY 4.0). They show India as the Survey of India shows it.
- The borders of the other countries come from [Natural Earth](https://www.naturalearthdata.com) (public domain).
- The population on the Flood risk page comes from [WorldPop](https://www.worldpop.org) 2011, India, 1 km (CC BY 4.0). It is 2011 data. [challenges.md](challenges.md) tells why.

### How to make the demo data again

| Script | Output | Requirement |
|---|---|---|
| `demo/make_map.py` | The border files | The DataMeet and Natural Earth files |
| `demo/make_windows.py` | The 9 weather windows | The data file and the kit of the organisers |
| `demo/make_flood.py` | The flood limits (`demo/data/flood.js`) | The data file. It runs the twin for approximately 3 minutes. |
| `demo/make_population.py <file>` | The population grid (`demo/data/population.js`) | `rasterio` (BSD-3) and the WorldPop file |

Download the WorldPop file manually from `https://data.worldpop.org/GIS/Population/Global_2000_2020_1km/2011/IND/ind_ppp_2011_1km_Aggregated.tif`. The script does not use the internet.

### How to put the demo on Railway

The `Dockerfile` runs the server and the demo site in 1 container. It uses only open-source maths libraries: PyTorch from conda-forge, on OpenBLAS. In the container, `serve.py` listens on port 8000. `demo/serve_demo.py` shows the site on the public port of Railway. It sends `/health` and `/simulate` to the server. `railway.json` tells Railway to use the `Dockerfile`.

1. Push the repository to GitHub.
2. On [railway.com](https://railway.com), select **New Project → Deploy from GitHub repo**.
3. Select this repository. Railway builds the `Dockerfile`. The first build takes some minutes.
4. Select **Settings → Networking → Generate Domain**.
5. Open the link.

To run the same container on your computer:

```bash
docker build -t monsoon-twin-demo . && docker run -p 8080:8080 monsoon-twin-demo
```

Then open http://localhost:8080.
