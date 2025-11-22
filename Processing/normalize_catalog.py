#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stream-normalize catalog JSONL into DB-ready envelopes.

Each *input line* is any scraped blob (course page, list page, mixed sections).
Each *output line* is an OutputEnvelope JSON ready for DB insertion.

Usage:
  python normalize_catalog_jsonl.py --in courses.jsonl --out envelopes.jsonl
  python normalize_catalog_jsonl.py --in - --out - --model qwen2.5:14b-instruct

Requires:
  pip install ollama pydantic
"""

from __future__ import annotations
from typing import List, Optional, Literal, Union, Dict, Any, Iterable, Tuple
from pydantic import BaseModel, Field, constr, ValidationError
from datetime import datetime, timezone
import hashlib
import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import uuid

# Although not directly used for the hardcoded HTML, keep ollama import for potential future use
import ollama
from bs4 import BeautifulSoup

# -------------------------
# Constants for HTML parsing
# -------------------------
SOFTWARE_ENGINEERING_PROGRAM_URL = "https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/H1zle10Cs3?searchTerm=software%20engineering&bc=true&bcCurrent=Software%20Engineering%20(Bachelor%20of%20Software%20Engineering%20-%20Honours)&bcItemType=programs"

SOFTWARE_ENGINEERING_PROGRAM_HTML = """
<section class=\"uw-academic-calendar__program-requirements\" id=\"program-requirements\">

  <h2>Software Engineering (Bachelor of Software Engineering - Honours)</h2>



  <section class=\"uw-academic-calendar__requirements-summary\" id=\"requirements-summary\">

    <h3>Graduation Requirements</h3>

    <ul>

      <li>Complete a total of 21.50 units (excluding COOP, PD):

        <ul>

          <li>Complete all the required courses listed below.</li>

          <li>Complete 12 approved electives:

            <ul>

              <li>Complete two Complementary Studies Electives (CSEs) from the Complementary Studies Course Lists for Engineering:

                <ul>

                  <li>One course from List A.</li>

                  <li>One course from List C.</li>

                </ul>

              </li>

              <li>Complete three courses from the Natural Science list.</li>

              <li>Complete four courses from the Technical Electives (TEs) lists.</li>

              <li>Complete the Undergraduate Communication Requirement.</li>

              <li>Complete two electives chosen from any 0.5-unit courses.</li>

            </ul>

          </li>

        </ul>

      </li>

      <li>Complete all co-operative education program requirements listed below.</li>

    </ul>



    <h4>Undergraduate Communication Requirement</h4>

    <p>See below for the list of courses that can be used towards this requirement. The course must be completed with a minimum grade of 60.0% prior to enrolling in the 3A term.</p>



    <h3>Co-operative Education Program Requirements</h3>

    <ul>

      <li>Complete a total of five PD courses: PD10, PD11, PD19, PD20, and one additional PD course.</li>

      <li>Complete a total of five credited work terms.</li>

    </ul>



    <details class=\"uw-sequence-legend\">

      <summary>Legend for Study/Work Sequences Chart</summary>

      <table>

        <thead><tr><th>Key</th><th>Description</th></tr></thead>

        <tbody>

          <tr><td>F,W,S</td><td>Terms: F=September-December; W=January-April; S=May-August</td></tr>

          <tr><td>1,2,3,4 plus A or B</td><td>Denotes academic year and term.</td></tr>

          <tr><td>WT</td><td>Work term.</td></tr>

        </tbody>

      </table>

    </details>



    <div class=\"uw-sequence-chart\">

      <h4>Study/Work Sequences Chart</h4>

      <table>

        <thead>

          <tr>

            <th>Sequence</th><th>F</th><th>W</th><th>S</th><th>F</th><th>W</th><th>S</th><th>F</th><th>W</th><th>S</th><th>F</th><th>W</th><th>S</th><th>F</th><th>W</th>

          </tr>

        </thead>

        <tbody>

          <tr><td>Stream 8X</td><td>1A</td><td>1B</td><td>WT</td><td>2A</td><td>WT</td><td>2B</td><td>WT</td><td>3A</td><td>WT</td><td>3B</td><td>WT</td><td>WT</td><td>4A</td><td>4B</td></tr>

          <tr><td>Stream 8Y</td><td>1A</td><td>1B</td><td>WT</td><td>2A</td><td>WT</td><td>2B</td><td>WT</td><td>3A</td><td>WT</td><td>3B</td><td>4A</td><td>WT</td><td>WT</td><td>4B</td></tr>

        </tbody>

      </table>

      <ol class=\"uw-sequence-notes\">

        <li>Stream 8X is the primary stream. Students may choose to switch to stream 8Y after the 3B term, with advisor approval.</li>

      </ol>

    </div>

  </section>



  <section class=\"uw-academic-calendar__required-courses\" id=\"required-courses-by-term\">

    <h3>Course Requirements</h3>



    <article class=\"uw-term uw-term--1a\" id=\"term-1a\">

      <h4>1A Term</h4>

      <ul>

        <li>CS137 - Programming Principles (0.50)</li>

        <li>CHE102 - Chemistry for Engineers (0.50)</li>

        <li>MATH115 - Linear Algebra for Engineering (0.50)</li>

        <li>MATH117 - Calculus 1 for Engineering (0.50)</li>

        <li>MATH135 - Algebra for Honours Mathematics (0.50)</li>

        <li>SE101 - Introduction to Methods of Software Engineering (0.25)</li>

      </ul>

    </article>



    <article class=\"uw-term uw-term--1b\" id=\"term-1b\">

      <h4>1B Term</h4>

      <ul>

        <li>CS138 - Introduction to Data Abstraction and Implementation (0.50)</li>

        <li>ECE124 - Digital Circuits and Systems (0.50)</li>

        <li>ECE140 - Linear Circuits (0.50)</li>

        <li>ECE192 - Engineering Economics and Impact on Society (0.25)</li>

        <li>MATH119 - Calculus 2 for Engineering (0.50)</li>

        <li>SE102 - Seminar (0.00)</li>

      </ul>

      <p>Complete 1 approved elective</p>

    </article>



    <article class=\"uw-term uw-term--2a\" id=\"term-2a\">

      <h4>2A Term</h4>

      <ul>

        <li>CS241 - Foundations of Sequential Programs (0.50)</li>

        <li>ECE222 - Digital Computers (0.50)</li>

        <li>SE201 - Seminar (0.00)</li>

        <li>SE212 - Logic and Computation (0.50)</li>

        <li>STAT206 - Statistics for Software Engineering (0.50)</li>

      </ul>

      <p>Complete 1 of the following: ECE105, PHYS115, PHYS121 (each 0.50)</p>

    </article>



    <article class=\"uw-term uw-term--2b\" id=\"term-2b\">

      <h4>2B Term</h4>

      <ul>

        <li>CS240 - Data Structures and Data Management (0.50)</li>

        <li>CS247 - Software Engineering Principles (0.50)</li>

        <li>CS348 - Introduction to Database Management (0.50)</li>

        <li>MATH239 - Introduction to Combinatorics (0.50)</li>

        <li>SE202 - Seminar (0.00)</li>

      </ul>

      <p>Complete 1 approved elective</p>

    </article>



    <article class=\"uw-term uw-term--3a\" id=\"term-3a\">

      <h4>3A Term</h4>

      <ul>

        <li>CS341 - Algorithms (0.50)</li>

        <li>MATH213 - Signals, Systems, and Differential Equations (0.50)</li>

        <li>SE301 - Seminar (0.00)</li>

        <li>SE350 - Operating Systems (0.50)</li>

        <li>SE464 - Software Design and Architectures (0.50)</li>

        <li>SE465 - Software Testing and Quality Assurance (0.50)</li>

      </ul>

      <p>Complete 1 approved elective</p>

    </article>



    <article class=\"uw-term uw-term--3b\" id=\"term-3b\">

      <h4>3B Term</h4>

      <ul>

        <li>CS343 - Concurrent and Parallel Programming (0.50)</li>

        <li>ECE358 - Computer Networks (0.50)</li>

        <li>SE302 - Seminar (0.00)</li>

        <li>SE380 - Introduction to Feedback Control (0.50)</li>

        <li>SE463 - Software Project Management, Requirements, and Analysis (0.50)</li>

      </ul>

      <p>Complete 1 of the following: CS349, CS449, MSE343 (each 0.50)</p>

      <p>Complete 1 approved elective</p>

    </article>



    <article class=\"uw-term uw-term--4a\" id=\"term-4a\">

      <h4>4A Term</h4>

      <ul>

        <li>SE401 - Seminar (0.00)</li>

      </ul>

      <p>Complete 1 of the following: GENE403 or SE490 (0.50)</p>

      <p>Complete 4 approved electives</p>

    </article>



    <article class=\"uw-term uw-term--4b\" id=\"term-4b\">

      <h4>4B Term</h4>

      <ul>

        <li>SE402 - Seminar (0.00)</li>

      </ul>

      <p>Complete 1 of the following: GENE404 or SE491 (0.50)</p>

      <p>Complete 4 approved electives</p>

    </article>

  </section>



  <section class=\"uw-academic-calendar__electives\" id=\"electives\">

    <h3>Course Lists</h3>



    <article class=\"uw-ucr\" id=\"undergraduate-communication-requirement\">

      <h4>Undergraduate Communication Requirement</h4>

      <p>Complete 1 of the following:</p>

      <ul>

        <li>COMMST100 - Interpersonal Communication (0.50)</li>

        <li>COMMST223 - Public Speaking (0.50)</li>

        <li>EMLS101R - Oral Communications for Academic Purposes (0.50)</li>

        <li>EMLS102R - Clear Communication in English Writing (0.50)</li>

        <li>EMLS129R - Written Academic English (0.50)</li>

        <li>ENGL109 - Introduction to Academic Writing (0.50)</li>

        <li>ENGL119 - Communications in Mathematics and Computer Science (0.50)</li>

        <li>ENGL129R - Written Academic English (0.50)</li>

        <li>ENGL209 - Advanced Academic Writing (0.50)</li>

        <li>ENGL210E - Genres of Technical Communication (0.50)</li>

      </ul>

    </article>



    <article class=\"uw-natural-science\" id=\"natural-science-list\">

      <h4>Natural Science List</h4>

      <p>Complete a total of 3 lecture courses (see Additional Constraints).</p>

      <ul class=\"uw-course-list\">

        <li>AMATH382 - Computational Modelling of Cellular Systems (0.50)</li>

        <li>BIOL110 - Biodiversity, Biomes, and Evolution (0.50)</li>

        <li>BIOL130 - Introductory Cell Biology (0.50)</li>

        <li>BIOL130L - Cell Biology Laboratory (0.25)</li>

        <li>BIOL150 - Organismal and Evolutionary Ecology (0.50)</li>

        <li>BIOL165 - Diversity of Life (0.50)</li>

        <li>BIOL211 - Introductory Vertebrate Zoology (0.50)</li>

        <li>BIOL220 - Introduction to Plant Structure and Function (0.50)</li>

        <li>BIOL239 - Genetics (0.50)</li>

        <li>BIOL240 - Fundamentals of Microbiology (0.50)</li>

        <li>BIOL240L - Microbiology Laboratory (0.25)</li>

        <li>BIOL241 - Introduction to Applied Microbiology (0.50)</li>

        <li>BIOL273 - Principles of Human Physiology 1 (0.50)</li>

        <li>BIOL280 - Introduction to Biophysics (0.50)</li>

        <li>BIOL365 - Methods in Bioinformatics (0.50)</li>

        <li>BIOL373 - Principles of Human Physiology 2 (0.50)</li>

        <li>BIOL373L - Human Physiology Laboratory (0.25)</li>

        <li>BIOL376 - Cellular Neurophysiology (0.50)</li>

        <li>BIOL382 - Computational Modelling of Cellular Systems (0.50)</li>

        <li>BIOL469 - Genomics (0.50)</li>

        <li>BIOL476 - Systems Neuroscience: From Neurons to Behaviour (0.50)</li>

        <li>BIOL489 - Arctic Ecology (0.50)</li>

        <li>CHE161 - Engineering Biology (0.50)</li>

        <li>CHEM123 - General Chemistry 2 (0.50)</li>

        <li>CHEM123L - General Chemistry Laboratory 2 (0.25)</li>

        <li>CHEM209 - Introductory Spectroscopy and Structure (0.50)</li>

        <li>CHEM237 - Introductory Biochemistry (0.50)</li>

        <li>CHEM237L - Introductory Biochemistry Laboratory (0.25)</li>

        <li>CHEM254 - Introductory Chemical Thermodynamics (0.50)</li>

        <li>CHEM262 - Organic Chemistry for Engineering (0.50)</li>

        <li>CHEM262L - Organic Chemistry Laboratory for Engineering Students (0.25)</li>

        <li>CHEM266 - Basic Organic Chemistry 1 (0.50)</li>

        <li>CHEM356 - Introductory Quantum Mechanics (0.50)</li>

        <li>CS482 - Computational Techniques in Biological Sequence Analysis (0.50)</li>

        <li>EARTH121 - Introductory Earth Sciences (0.50)</li>

        <li>EARTH122 - Introductory Environmental Sciences (0.50)</li>

        <li>EARTH123 - Introductory Hydrology (0.50)</li>

        <li>EARTH221 - Introductory Geochemistry (0.50)</li>

        <li>EARTH270 - Disasters and Natural Hazards (0.50)</li>

        <li>EARTH281 - Geological Impacts on Human Health (0.50)</li>

        <li>ECE106 - Electricity and Magnetism (0.50)</li>

        <li>ECE231 - Semiconductor Physics and Devices (0.50)</li>

        <li>ECE305 - Introduction to Quantum Mechanics (0.50)</li>

        <li>ECE403 - Thermal Physics (0.50)</li>

        <li>ECE404 - Geometrical and Physical Optics (0.50)</li>

        <li>ENVE275 - Aquatic Chemistry (0.50)</li>

        <li>ENVS200 - Field Ecology (0.50)</li>

        <li>NE222 - Organic Chemistry for Nanotechnology Engineers (0.50)</li>

        <li>PHYS122 - Waves, Electricity and Magnetism (0.50)</li>

        <li>PHYS124 - Modern Physics (0.50)</li>

        <li>PHYS175 - Introduction to the Universe (0.50)</li>

        <li>PHYS233 - Introduction to Quantum Mechanics (0.50)</li>

        <li>PHYS234 - Quantum Physics 1 (0.50)</li>

        <li>PHYS263 - Classical Mechanics and Special Relativity (0.50)</li>

        <li>PHYS275 - Planets (0.50)</li>

        <li>PHYS280 - Introduction to Biophysics (0.50)</li>

        <li>PHYS334 - Quantum Physics 2 (0.50)</li>

        <li>PHYS335 - Condensed Matter Physics (0.50)</li>

        <li>PHYS375 - Stars (0.50)</li>

        <li>PHYS380 - Molecular and Cellular Biophysics (0.50)</li>

        <li>PHYS468 - Introduction to the Implementation of Quantum Information Processing (0.50)</li>

        <li>PSYCH207 - Cognitive Processes (0.50)</li>

        <li>PSYCH261 - Physiological Psychology (0.50)</li>

        <li>PSYCH306 - Perception (0.50)</li>

        <li>PSYCH307 - Human Neuropsychology (0.50)</li>

        <li>SCI200 - Energy - Its Development, Use, and Issues (0.50)</li>

        <li>SCI201 - Global Warming and Climate Change (0.50)</li>

        <li>SCI238 - Introductory Astronomy (0.50)</li>

        <li>SCI250 - Environmental Geology (0.50)</li>

      </ul>

      <p class=\"uw-additional-constraint\">For the Natural Science requirement, if a 0.25-laboratory course accompanies a lecture course, the laboratory course must also be taken and the pair together count as one course towards the three-course requirement (e.g., BIOL130 with BIOL130L).</p>

    </article>



    <article class=\"uw-technical-electives\" id=\"technical-electives\">

      <h4>Technical Electives List</h4>

      <p>Complete a minimum of 4 Technical Electives.</p>



      <section class=\"uw-te-list uw-te-list--1\" id=\"te-list-1\">

        <h5>List 1</h5>

        <ul>

          <li>AMATH242 - Introduction to Computational Mathematics (0.50)</li>

          <li>AMATH449 - Neural Networks (0.50)</li>

          <li>CS360 - Introduction to the Theory of Computing (0.50)</li>

          <li>CS365 - Models of Computation (0.50)</li>

          <li>CS370 - Numerical Computation (0.50)</li>

          <li>CS371 - Introduction to Computational Mathematics (0.50)</li>

          <li>CS442 - Principles of Programming Languages (0.50)</li>

          <li>CS444 - Compiler Construction (0.50)</li>

          <li>CS448 - Database Systems Implementation (0.50)</li>

          <li>CS450 - Computer Architecture (0.50)</li>

          <li>CS451 - Data-Intensive Distributed Computing (0.50)</li>

          <li>CS452 - Real-Time Programming (0.50)</li>

          <li>CS453 - Software and Systems Security (0.50)</li>

          <li>CS454 - Distributed Systems (0.50)</li>

          <li>CS457 - System Performance Evaluation (0.50)</li>

          <li>CS459 - Privacy, Cryptography, Network and Data Security (0.50)</li>

          <li>CS462 - Formal Languages and Parsing (0.50)</li>

          <li>CS466 - Algorithm Design and Analysis (0.50)</li>

          <li>CS479 - Neural Networks (0.50)</li>

          <li>CS480 - Introduction to Machine Learning (0.50)</li>

          <li>CS484 - Computational Vision (0.50)</li>

          <li>CS485 - Statistical and Computational Foundations of Machine Learning (0.50)</li>

          <li>CS486 - Introduction to Artificial Intelligence (0.50)</li>

          <li>CS487 - Introduction to Symbolic Computation (0.50)</li>

          <li>CS488 - Introduction to Computer Graphics (0.50)</li>

          <li>CS489 - Advanced Topics in Computer Science (0.50)</li>

        </ul>

      </section>



      <section class=\"uw-te-list uw-te-list--2\" id=\"te-list-2\">

        <h5>List 2</h5>

        <ul>

          <li>ECE313 - Digital Signal Processing (0.50)</li>

          <li>ECE320 - Computer Architecture (0.50)</li>

          <li>ECE327 - Digital Hardware Systems (0.50)</li>

          <li>ECE340 - Electronic Circuits 2 (0.50)</li>

          <li>ECE405A - Quantum Information Processing Devices (0.50)</li>

          <li>ECE405B - Fundamentals of Experimental Quantum Information (0.50)</li>

          <li>ECE405C - Programming of Quantum Computing Algorithms (0.50)</li>

          <li>ECE405D - Superconducting Quantum Circuits (0.50)</li>

          <li>ECE409 - Cryptography and System Security (0.50)</li>

          <li>ECE416 - Advanced Topics in Networking (0.50)</li>

          <li>ECE417 - Image Processing (0.50)</li>

          <li>ECE423 - Embedded Computer Systems (0.50)</li>

          <li>ECE454 - Distributed Computing (0.50)</li>

          <li>ECE455 - Embedded Software (0.50)</li>

          <li>ECE457A - Co-operative and Adaptive Algorithms (0.50)</li>

          <li>ECE457B - Fundamentals of Computational Intelligence (0.50)</li>

          <li>ECE457C - Reinforcement Learning (0.50)</li>

          <li>ECE458 - Computer Security (0.50)</li>

          <li>ECE459 - Programming for Performance (0.50)</li>

          <li>ECE481 - Digital Control Systems (0.50)</li>

          <li>ECE486 - Robot Dynamics and Control (0.50)</li>

          <li>ECE488 - Multivariable Control Systems (0.50)</li>

          <li>ECE493 - Special Topics in Electrical and Computer Engineering (0.50)</li>

          <li>ECE495 - Autonomous Vehicles (0.50)</li>

        </ul>

      </section>



      <section class=\"uw-te-list uw-te-list--3\" id=\"te-list-3\">

        <h5>List 3</h5>

        <p>Complete 2 additional course from List 1, List 2, or List 3.</p>

        <ul>

          <li>BIOL487 - Computational Neuroscience (0.50)</li>

          <li>CO331 - Coding Theory (0.50)</li>

          <li>CO342 - Introduction to Graph Theory (0.50)</li>

          <li>CO351 - Network Flow Theory (0.50)</li>

          <li>CO353 - Computational Discrete Optimization (0.50)</li>

          <li>CO367 - Nonlinear Optimization (0.50)</li>

          <li>CO456 - Introduction to Game Theory (0.50)</li>

          <li>CO481 - Introduction to Quantum Information Processing (0.50)</li>

          <li>CO485 - The Mathematics of Public-Key Cryptography (0.50)</li>

          <li>CO487 - Applied Cryptography (0.50)</li>

          <li>CS467 - Introduction to Quantum Information Processing (0.50)</li>

          <li>MSE343 - Human-Computer Interaction (0.50)</li>

          <li>MSE446 - Introduction to Machine Learning (0.50)</li>

          <li>MSE543 - Analytics and User Experience (0.50)</li>

          <li>MTE544 - Autonomous Mobile Robots (0.50)</li>

          <li>MTE546 - Multi-Sensor Data Fusion (0.50)</li>

          <li>PHYS467 - Introduction to Quantum Information Processing (0.50)</li>

          <li>SE498 - Advanced Topics in Software Engineering (0.50)</li>

          <li>STAT440 - Computational Inference (0.50)</li>

          <li>STAT441 - Statistical Learning - Classification (0.50)</li>

          <li>STAT442 - Data Visualization (0.50)</li>

          <li>STAT444 - Statistical Learning - Advanced Regression (0.50)</li>

          <li>SYDE533 - Conflict Resolution (0.50)</li>

          <li>SYDE543 - Cognitive Ergonomics (0.50)</li>

          <li>SYDE548 - User Centred Design Methods (0.50)</li>

          <li>SYDE552 - Computational Neuroscience (0.50)</li>

          <li>SYDE556 - Simulating Neurobiological Systems (0.50)</li>

          <li>SYDE575 - Image Processing (0.50)</li>

        </ul>

      </section>



      <p class=\"uw-te-constraint\">Courses in the Technical Electives Lists may not be taken before the 3A term.</p>

    </article>



    <article class=\"uw-additional-reqs\" id=\"additional-requirements\">

      <h4>Additional Requirements</h4>

      <p>Complete 1 sustainability-related course, from the following list. This course may also be counted towards another elective requirement (e.g., Natural Science elective, Complementary Studies elective) if part of that list.</p>

      <ul>

        <li>BIOL489 - Arctic Ecology (0.50)</li>

        <li>EARTH270 - Disasters and Natural Hazards (0.50)</li>

        <li>ENBUS102 - Introduction to Environment and Business (0.50)</li>

        <li>ENBUS211 - Principles of Marketing for Sustainability Professionals (0.50)</li>

        <li>ENGL248 - Literature for an Ailing Planet (0.50)</li>

        <li>ENVS105 - Environmental Sustainability and Ethics (0.50)</li>

        <li>ENVS200 - Field Ecology (0.50)</li>

        <li>ENVS205 - Sustainability: The Future We Want (0.50)</li>

        <li>ENVS220 - Ecological Economics (0.50)</li>

        <li>ERS215 - Environmental and Sustainability Assessment 1 (0.50)</li>

        <li>ERS225 - Gendering Environmental Politics (0.50)</li>

        <li>ERS253 - Communities and Sustainability (0.50)</li>

        <li>ERS270 - Introduction to Sustainable Agroecosystems (0.50)</li>

        <li>ERS294 - Spirituality, Religion, and Ecology (0.50)</li>

        <li>ERS310 - Peace and the Environment (0.50)</li>

        <li>ERS316 - Urban Water and Wastewater Systems: Integrated Planning and Management (0.50)</li>

        <li>ERS320 - Economics and Sustainability (0.50)</li>

        <li>ERS328 - Environmental Politics and System Change (0.50)</li>

        <li>ERS361 - Food Systems and Sustainability (0.50)</li>

        <li>ERS370 - Corporate Sustainability: Issues and Prospects (0.50)</li>

        <li>ERS372 - First Nations and the Environment (0.50)</li>

        <li>ERS404 - Global Environmental Governance (0.50)</li>

        <li>GEOG203 - Environment and Development in a Global Perspective (0.50)</li>

        <li>GEOG207 - Climate Change Fundamentals (0.50)</li>

        <li>GEOG225 - Global Environment and Health (0.50)</li>

        <li>GEOG361 - Food Systems and Sustainability (0.50)</li>

        <li>GEOG459 - Energy and Sustainability (1.00)</li>

        <li>PACS310 - Peace and the Environment (0.50)</li>

        <li>PHIL224 - Environmental Ethics (0.50)</li>

        <li>PLAN451 - Environmental Planning in Rural and Regional Systems (0.50)</li>

        <li>PSCI432 - Global Environmental Governance (0.50)</li>
        <li>R
"""

# -------------------------
# Shared types (match DB)
# -------------------------

TermCode = constr(pattern=r"^[1-4][AB]$")  # Waterloo-style "1A..4B"

class CourseRelation(BaseModel):
    kind: Literal["prereq", "coreq", "exclusion"]
    logic: str
    source_span: Optional[str] = None

_CODE_RE = re.compile(r"\b([A-Z]{2,5})\s*-?\s*(\d{2,3}[A-Z]?)\b")  # e.g., CS 241, MATH119, ECE 105A

def normalize_code(text: Optional[str]) -> Optional[str]:
    if not text: return None
    m = _CODE_RE.search(text.replace("\xa0", " "))
    if not m: return None
    subj, num = m.group(1), m.group(2)
    return f"{subj} {num}"

class EnrollmentConstraint(BaseModel):
    type: Literal[
        "program_in", "faculty_in", "term_at_least", "term_in",
        "standing", "plan_in", "consent_required"
    ]
    values: Optional[List[str]] = None
    term: Optional[TermCode] = None
    message: Optional[str] = None

class Course(BaseModel):
    code: str
    title: str
    credits: float
    level: int
    subject: str
    description: Optional[str] = None
    attributes: Optional[List[str]] = None
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    source_url: Optional[str] = None
    source_hash: Optional[str] = None
    fetched_at: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0, le=1)

    relations: List[CourseRelation] = Field(default_factory=list)
    enrollment_constraints: List[EnrollmentConstraint] = Field(default_factory=list)

    notes: Optional[List[str]] = None

class CourseSet(BaseModel):
    id_hint: Optional[str] = None
    mode: Literal["explicit", "selector"] = "explicit"
    title: Optional[str] = None
    selector: Optional[Dict[str, Any]] = None
    courses: List[str] = Field(default_factory=list)  # by course code, e.g., "CS 137"

class RequirementNode(BaseModel):
    id_hint: Optional[str] = None
    type: Literal["ALL", "ANY", "N_OF", "CREDITS_AT_LEAST", "NOT"]
    n: Optional[int] = None
    minCredits: Optional[float] = None
    children: Optional[List['RequirementNode']] = None
    courseSet: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None
    constraints: Optional[List[str]] = None
    explanations: Optional[List[str]] = None

RequirementNode.model_rebuild()

class ProgramShell(BaseModel):
    kind: Optional[Literal["degree","major","minor","option","specialization"]] = None
    scope: Optional[Literal["institution_wide","faculty_scoped","program_scoped"]] = None
    title: Optional[str] = None
    catalog_year_label: Optional[str] = None
    owning_faculty_code: Optional[str] = None
    owning_program_codes: Optional[List[str]] = None
    total_credits_required: Optional[float] = None
    policy_ids_hints: Optional[List[str]] = None
    root_requirement: Optional[RequirementNode] = None
    # Add these fields to ProgramShell to directly store parsed program data
    required_by_term: Dict[str, List[Dict[str, str]]] = Field(default_factory=dict)
    course_lists: Dict[str, List[Dict[str, str]]] = Field(default_factory=dict)

class OutputEnvelope(BaseModel):
    courses: List[Course] = Field(default_factory=list)
    course_sets: List[CourseSet] = Field(default_factory=list)
    requirements: List[RequirementNode] = Field(default_factory=list)
    program: Optional[ProgramShell] = None
    provenance: Dict[str, Any] = Field(default_factory=dict)

# -------------------------
# Heuristics (pre/post)
# -------------------------

def _subject_level(code: Optional[str]) -> tuple[str,int]:
    if not code: return ("", 0)
    m = _CODE_RE.search(code)
    if not m: return ("", 0)
    subj, num = m.group(1), m.group(2)
    digits = re.findall(r"\d+", num)
    level = 0
    if digits:
        n = int(digits[0])
        level = 400 if n >= 400 else 300 if n >= 300 else 200 if n >= 200 else 100
    return (subj, level)

def _float_units(u: Optional[Union[str,float,int]]) -> Optional[float]:
    if u is None: return None
    s = str(u).strip()
    # normalize "0.50" / "0,50" / "0" / "0.00"
    s = s.replace(",", ".")
    try:
        return float(s)
    except:
        # try to extract first float-like token
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        return float(m.group(1)) if m else None

def _stable_id_hint(parts: List[str]) -> str:
    base = "::".join([p for p in parts if p])
    if not base: base = "unk"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:10]

def _now_iso() -> str:
    # DeprecationWarning: datetime.datetime.utcnow() is deprecated
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

# -------------------------
# System & User prompts
# -------------------------

SYSTEM_PROMPT = """You normalize university catalog content to a STRICT JSON envelope for database loading.
Obey the provided JSON Schema exactly.

Guidelines:
- If given a single course blob, fill one Course. Parse code ('CS 343') from title 'CS343 - ...' if needed.
- Convert 'units' or 'credits' to number (0.50 -> 0.5). '0.00' -> 0.0 is fine for seminars/zero-unit.
- Derive subject & level from code (e.g., 3xx -> level 300).
- Map textual prereq/coreq/antireq into CourseRelation using boolean mini-language:
    ALL(...), ANY(...), NOT(...), with operands like course:CS-350 or course:SE-350.
- If prereqs mention plan/faculty/term restrictions (e.g., "Enrolled in H-Software Engineering", "2A or above"),
  put them in enrollment_constraints with type program_in/faculty_in/term_at_least.
- If 'course_lists' exist, produce a CourseSet per list (mode='explicit') with course codes.
- If 'required_by_term' exists, build a RequirementNode tree:
    root: ALL(children per term in ascending order)
    each term: ALL(courseSet="<term-label>") where the CourseSet contains that term's listed courses.
- Keep explanations human readable. If unsure, be conservative and add a note.
Return ONLY JSON.
"""

def _parse_program_text_for_requirements(raw_text: str) -> Dict[str, Any]:
    # This function is deprecated and replaced by direct structured data from uw_se_scraper.py
    return {"required_by_term": {}, "course_lists": {}}

def _parse_program_html_for_requirements(html_content: str) -> Dict[str, Any]:
    program_data = {
        "title": "",
        "required_by_term": {},
        "course_lists": {},
        "any_requirements_by_term": {}  # Maps term -> list of course codes that are "select one"
    }

    print("--- Starting _parse_program_html_for_requirements ---")
    # Extract program title from h2
    title_match = re.search(r"<h2 class=\"program-view__title___x6bi1\">(.*?)</h2>", html_content)
    if title_match:
        program_data["title"] = title_match.group(1).strip()
    # print(f"Parsed Program Title (from HTML): {program_data['title']}")

    # Extract term-based requirements
    # The HTML structure is:
    # <section><header data-test="grouping-0-header">...<span>1A Term</span>...</header>
    #   <div><div><ul>
    #     <li data-test="ruleView-A"><div data-test="ruleView-A-result">Complete all the following: <div><ul>...</ul></div></div></li>
    #     <li data-test="ruleView-B"><div data-test="ruleView-B-result">Complete 1 of the following: ...</div></li>
    #   </ul></div></div>
    # </section>
    
    # Pattern to find term sections
    term_section_pattern = re.compile(
        r"<section class=\"\"><header data-test=\"grouping-\d+-header\"[^>]*><div><div class=\"style__itemHeaderH2___2f-ov\"><span>(?P<term_name>[1-4][AB])\s+Term</span></div>.*?</header>.*?(?=<section class=\"\"|<h3|$)",
        re.DOTALL | re.IGNORECASE
    )
    
    # Extract courses from each term section
    for term_match in term_section_pattern.finditer(html_content):
        term_name = term_match.group("term_name")
        term_section = term_match.group(0)
        
        all_courses = []  # Courses that are ALL requirements
        any_courses = []  # Courses that are ANY requirements
        
        # Find ruleView-A-result (ALL requirements) - "Complete all the following"
        rule_a_pattern = re.compile(
            r'<div data-test="ruleView-A-result">.*?<ul[^>]*>(?P<courses_html>.*?)</ul>',
            re.DOTALL | re.IGNORECASE
        )
        for rule_a_match in rule_a_pattern.finditer(term_section):
            courses_html = rule_a_match.group("courses_html")
            # Extract course codes and titles from nested ul
            # Pattern: <li><span><a href="...">CODE</a> - Title <span>(credits)</span></span></li>
            # Match title between </a> and the credits span or closing tag
            course_item_pattern = re.compile(
                r'<li[^>]*>.*?<a[^>]*href="#/courses/view/[^"]*"[^>]*>(?P<code>[A-Z]{2,5}\s*\d{2,3}[A-Z]?)</a>\s*[-–—]\s*(?P<title>.*?)(?:\s*<span[^>]*>\([0-9.]+\)</span>|</span></li>)',
                re.DOTALL | re.IGNORECASE
            )
            for course_item_match in course_item_pattern.finditer(courses_html):
                code = course_item_match.group("code").replace(" ", "")
                title = course_item_match.group("title").strip()
                # Clean up any remaining HTML entities or tags in the title
                title = re.sub(r'<[^>]+>', '', title).strip()
                all_courses.append({"code": code, "title": title})
        
        # Find ruleView-C-result (ANY requirements) - "Complete 1 of the following"
        # Note: ruleView-B-result is for general electives (not specific course lists)
        # ruleView-C-result is for "Complete 1 of the following: <course list>"
        # Format: <div data-test="ruleView-C-result">Complete <span>1</span> of the following: <div><ul>...</ul></div></div>
        rule_c_pattern = re.compile(
            r'<div data-test="ruleView-C-result">.*?Complete\s*<span>\s*1\s*</span>\s*of\s+the\s+following:\s*<div><ul[^>]*>(?P<courses_html>.*?)</ul></div></div>',
            re.DOTALL | re.IGNORECASE
        )
        for rule_c_match in rule_c_pattern.finditer(term_section):
            courses_html = rule_c_match.group("courses_html")
            
            # Extract from ul list (same pattern as ruleView-A-result to get titles too)
            course_item_pattern = re.compile(
                r'<li[^>]*>.*?<a[^>]*href="#/courses/view/[^"]*"[^>]*>(?P<code>[A-Z]{2,5}\s*\d{2,3}[A-Z]?)</a>\s*[-–—]\s*(?P<title>.*?)(?:\s*<span[^>]*>\([0-9.]+\)</span>|</span></li>)',
                re.DOTALL | re.IGNORECASE
            )
            for course_item_match in course_item_pattern.finditer(courses_html):
                code = course_item_match.group("code").replace(" ", "")
                title = course_item_match.group("title").strip()
                # Clean up any remaining HTML entities or tags in the title
                title = re.sub(r'<[^>]+>', '', title).strip()
                any_courses.append({"code": code, "title": title})
        
        # Store ALL (required) courses in required_by_term
        # Store ANY (select one) courses separately - they should NOT be in required_by_term
        # They'll be represented as type="ANY" requirements instead
        if all_courses:
            program_data["required_by_term"][term_name] = all_courses
        
        if any_courses:
            # Convert any_courses list of codes/dicts to a list of dicts with code and title
            any_courses_dicts = []
            for item in any_courses:
                if isinstance(item, dict):
                    any_courses_dicts.append(item)
                else:
                    # It's just a code string, convert to dict
                    any_courses_dicts.append({"code": item, "title": ""})
            program_data["any_requirements_by_term"][term_name] = any_courses_dicts

    # Regex to find general course lists (electives, etc.)
    # This pattern needs to be more robust to find nested lists as well
    list_section_pattern = re.compile(
        r"<section class=\"\"><header(?: data-test=\"[^\"]+\")? class=\"\"><div><div class=\"style__itemHeaderH2___2f-ov\"><span>(?P<list_name>[^<]+?)</span></div>.*?</div>(?:<div[^>]*>)?(?:<ul>(?P<direct_courses_html>.*?)</ul>)?",
        re.DOTALL | re.IGNORECASE
    )

    for list_match in list_section_pattern.finditer(html_content):
        list_name = list_match.group("list_name").strip()
        direct_courses_html = list_match.group("direct_courses_html")
        
        current_list_courses = []
        if direct_courses_html:
            course_item_pattern = re.compile(
                r"<li>\s*(?:<span>)?(?:<a[^>]*>)?(?P<code>[A-Z]{2,5}\s*\d{2,3}[A-Z]?)(?:</a>)?\s*[-–—]?\s*(?P<title>[^<]+?)(?:\s*<span[^>]*>\([0-9.]+\)</span>)?\s*</li>",
                re.DOTALL | re.IGNORECASE
            )
            for course_item_match in course_item_pattern.finditer(direct_courses_html):
                code = course_item_match.group("code").replace(" ", "")
                title = course_item_match.group("title").strip()
                current_list_courses.append({"code": code, "title": title})

        if current_list_courses:
            program_data["course_lists"][list_name] = current_list_courses

        # Check for nested sections (like List 1, List 2 under Technical Electives List)
        # We need to search within the current list_match's span for nested sections
        # This requires re-parsing the inner HTML of the current section
        inner_section_html = list_match.group(0) # Get the full HTML of the current section
        nested_list_pattern = re.compile(
            r"<section class=\"\"><header(?: class=\"\")?><div><div class=\"style__itemHeaderH2___2f-ov\"><span>(?P<nested_list_name>List \d)</span></div>.*?</div>(?:<div[^>]*>)?(?:<ul>(?P<nested_courses_html>.*?)</ul>)?",
            re.DOTALL | re.IGNORECASE
        )
        for nested_list_match in nested_list_pattern.finditer(inner_section_html):
            nested_list_name = nested_list_match.group("nested_list_name").strip()
            nested_courses_html = nested_list_match.group("nested_courses_html")

            nested_courses_in_list = []
            if nested_courses_html:
                course_item_pattern = re.compile(
                    r"<li>\s*(?:<span>)?(?:<a[^>]*>)?(?P<code>[A-Z]{2,5}\s*\d{2,3}[A-Z]?)(?:</a>)?\s*[-–—]?\s*(?P<title>[^<]+?)(?:\s*<span[^>]*>\([0-9.]+\)</span>)?\s*</li>",
                    re.DOTALL | re.IGNORECASE
                )
                for nested_course_item_match in course_item_pattern.finditer(nested_courses_html):
                    code = nested_course_item_match.group("code").replace(" ", "")
                    title = nested_course_item_match.group("title").strip()
                    nested_courses_in_list.append({"code": code, "title": title})

            if nested_courses_in_list:
                program_data["course_lists"][nested_list_name] = nested_courses_in_list

    return program_data

def _inject_sets_from_required_by_term(out: OutputEnvelope, program_data: Dict[str, Any], any_requirements_by_term: Dict[str, List[Union[str, Dict[str, str]]]] = None):
    # Note: 'out' is the OutputEnvelope, 'program_data' is the dict from _parse_program_html_for_requirements
    # 'any_requirements_by_term' maps term -> list of course codes (or dicts with code/title) that are "select one" (ANY requirements)
    # This function creates CourseSets and RequirementNodes and appends them to 'out'
    if any_requirements_by_term is None:
        any_requirements_by_term = {}
    
    for term_name, courses_data in program_data.get("required_by_term", {}).items():
        course_codes = [course["code"] for course in courses_data]
        any_items_for_term = any_requirements_by_term.get(term_name, [])
        # Extract codes from any_items (which might be strings or dicts)
        any_codes_for_term = []
        for item in any_items_for_term:
            if isinstance(item, dict):
                any_codes_for_term.append(item["code"])
            else:
                any_codes_for_term.append(item)
        
        # Split courses into ALL (required) and ANY (select one)
        # ALL courses are those NOT in any_requirements_by_term
        all_courses = [code for code in course_codes if code not in any_codes_for_term]
        # ANY courses are those IN any_requirements_by_term
        any_courses = any_codes_for_term
        
        # Create ALL requirement node for required courses (if any)
        if all_courses:
            all_set_id_hint = f"req_term_{term_name.lower().replace(' ', '')}_all"
            out.course_sets.append(CourseSet(
                id_hint=all_set_id_hint,
                mode="explicit",
                title=f"Required {term_name}",
                selector=None,
                courses=all_courses
            ))
            req_node = RequirementNode(
                id_hint=all_set_id_hint,
                type="ALL",
                courseSet=all_set_id_hint,
                explanations=[f"Required courses in term {term_name}."]
            )
            out.requirements.append(req_node)
        
        # Create ANY requirement node for select-one courses (if any)
        if any_courses:
            any_set_id_hint = f"req_term_{term_name.lower().replace(' ', '')}_any"
            out.course_sets.append(CourseSet(
                id_hint=any_set_id_hint,
                mode="explicit",
                title=f"Select one from {term_name}",
                selector=None,
                courses=any_courses
            ))
            req_node = RequirementNode(
                id_hint=any_set_id_hint,
                type="ANY",
                courseSet=any_set_id_hint,
                explanations=[f"Complete 1 of the following courses in term {term_name}."]
            )
            out.requirements.append(req_node)

def _inject_sets_from_course_lists(out: OutputEnvelope, program_data: Dict[str, Any]):
    # Note: 'out' is the OutputEnvelope, 'program_data' is the dict from _parse_program_html_for_requirements
    # This function creates CourseSets and RequirementNodes and appends them to 'out'
    for list_name, courses_data in program_data.get("course_lists", {}).items():
        set_id_hint = f"course_list_{re.sub(r'[^a-zA-Z0-9_]', '', list_name).lower()}"

        course_codes = [course["code"] for course in courses_data]
        out.course_sets.append(CourseSet(
            id_hint=set_id_hint,
            mode="explicit",
            title=list_name,
            selector=None,
            courses=course_codes
        ))
        
        # Create a requirement node for this course list
        # This will typically be an ANY requirement (choose any from this list)
        req_node = RequirementNode(
            id_hint=set_id_hint, # Use the course set id_hint here
            type="ANY",
            courseSet=set_id_hint, # Reference to the course set by its id_hint
            explanations=[f"Complete courses from {list_name}."]
        )
        out.requirements.append(req_node)

def _build_user_prompt(scraped: Dict[str, Any]) -> str:
    return (
        "Scraped JSON follows. Transform to the OutputEnvelope JSON object.\n\n"
        + json.dumps(scraped, indent=2, ensure_ascii=False)
    )

# -------------------------
# Ollama structured call
# -------------------------

def _ollama_model(default: str) -> str:
    return os.environ.get("OLLAMA_MODEL", default)

def _call_ollama(scraped: Dict[str, Any], model: str) -> OutputEnvelope:
    schema = OutputEnvelope.model_json_schema()
    resp = ollama.chat(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(scraped)}
        ],
        options={"temperature": 0},
        format=schema,
    )
    content = resp["message"]["content"]
    return OutputEnvelope.model_validate_json(content)

# -------------------------
# Post-normalization
# -------------------------

def _normalize_courses(envelope: OutputEnvelope) -> None:
    for c in envelope.courses:
        c.code = normalize_code(c.code) or (c.code or "").strip()
        subj, lvl = _subject_level(c.code)
        if not c.subject: c.subject = subj
        if not c.level: c.level = lvl
        c.credits = _float_units(c.credits) or 0.0
        if not c.fetched_at: c.fetched_at = _now_iso()
        # Strip empty relations like ALL()
        c.relations = [r for r in c.relations if r.logic and r.logic.strip() not in ("ALL()", "ANY()")]

def _ensure_course_sets(envelope: OutputEnvelope) -> None:
    for cs in envelope.course_sets:
        if not cs.id_hint:
            cs.id_hint = _stable_id_hint([cs.title or "", ",".join(cs.courses)])

def _normalize_requirements(envelope: OutputEnvelope) -> None:
    def assign_ids(node: RequirementNode, prefix: str):
        if not node.id_hint:
            label = node.courseSet or node.type
            node.id_hint = _stable_id_hint([prefix, label])
        if node.children:
            for i, ch in enumerate(node.children):
                assign_ids(ch, prefix + f":{i}")
    for i, rn in enumerate(envelope.requirements):
        assign_ids(rn, f"req{i}")

def _inject_sets_from_course_lists(out: OutputEnvelope, program_data: Dict[str, Any]):
    # Note: 'out' is the OutputEnvelope, 'program_data' is the dict from _parse_program_html_for_requirements
    # This function creates CourseSets and RequirementNodes and appends them to 'out'
    for list_name, courses_data in program_data.get("course_lists", {}).items():
        set_id_hint = f"course_list_{re.sub(r'[^a-zA-Z0-9_]', '', list_name).lower()}"

        course_codes = [course["code"] for course in courses_data]
        out.course_sets.append(CourseSet(
            id_hint=set_id_hint,
            mode="explicit",
            title=list_name,
            selector=None,
            courses=course_codes
        ))
        
        # Create a requirement node for this course list
        # This will typically be an ANY requirement (choose any from this list)
        req_node = RequirementNode(
            id_hint=set_id_hint, # Use the course set id_hint here
            type="ANY",
            courseSet=set_id_hint, # Reference to the course set by its id_hint
            explanations=[f"Complete courses from {list_name}."]
        )
        out.requirements.append(req_node)

def _ensure_provenance(out: OutputEnvelope, scraped: Dict[str, Any]):
    out.provenance = {
        "timestamp": _now_iso(),
        "source_url": scraped.get("source_url"),
        "scraped_json_captured": scraped.get("json_captured", False),
    }

def _inject_requirements_from_course_data(out: OutputEnvelope, course_data: Dict[str, Any]):
    """This function can be implemented later if specific course-level requirements need to be injected."""
    pass

def normalize_scraped(scraped: Dict[str, Any]) -> OutputEnvelope:
    out = OutputEnvelope()
    
    # Handle program-level data first
    # Check for 'program_url' to identify program details entry
    if scraped.get("program_url"):
        # Step 1: Try to use structured data from scraper (JavaScript extraction) if available
        program_data = {
            "title": scraped.get("title", ""),
            "required_by_term": scraped.get("required_by_term", {}),
            "course_lists": scraped.get("course_lists", {}),
            "any_requirements_by_term": {}  # Will be populated from HTML parsing
        }
        
        # Step 2: If structured data is empty or missing, OR if we have HTML, parse HTML as fallback
        has_html = scraped.get("raw_program_html")
        needs_html_parsing = (
            not program_data["required_by_term"] or 
            not program_data["course_lists"] or
            has_html  # Always parse HTML to detect "Complete 1 of the following" patterns
        )
        
        if needs_html_parsing and has_html:
            html_parsed = _parse_program_html_for_requirements(scraped["raw_program_html"])
            # Merge HTML parsed data (if structured data was empty, use HTML parsed data)
            if not program_data["required_by_term"]:
                program_data["required_by_term"] = html_parsed.get("required_by_term", {})
            if not program_data["course_lists"]:
                program_data["course_lists"] = html_parsed.get("course_lists", {})
            if not program_data["title"]:
                program_data["title"] = html_parsed.get("title", "")
            # Store ANY requirements detected from HTML
            program_data["any_requirements_by_term"] = html_parsed.get("any_requirements_by_term", {})
        
        # Ensure program title is correctly set
        program_title = scraped.get("title") or program_data.get("title", "")
        if not program_title:
            program_title = "Unknown Program"

        # Clean and de-duplicate course lists before assigning to ProgramShell
        cleaned_required_by_term = {term: _clean_and_deduplicate_courses(courses) for term, courses in program_data.get("required_by_term", {}).items()}
        cleaned_course_lists = {list_name: _clean_and_deduplicate_courses(courses) for list_name, courses in program_data.get("course_lists", {}).items()}

        out.program = ProgramShell(
            kind="degree",
            title=program_title,
            required_by_term=cleaned_required_by_term,
            course_lists=cleaned_course_lists
        )
        
        # Generate course sets and requirements from the cleaned program data
        # Pass any_requirements info so we can create ANY nodes
        _inject_sets_from_required_by_term(out, out.program.model_dump(), program_data.get("any_requirements_by_term", {}))
        _inject_sets_from_course_lists(out, out.program.model_dump())

    # Process individual course data
    # This part should be after program data processing to ensure program-related course sets are available.
    # Filter out the program details entry if it's mistakenly included in course processing
    if not scraped.get("program_url") or not out.program: # Only process as individual course if not a program entry or if program data was not successfully extracted
        course_data = scraped.copy()
        if course_data.get("course_id") or course_data.get("code"):
            # Ensure code and title are correctly extracted for individual courses
            course_code = course_data.get("code")
            course_title = course_data.get("title")

            if not course_code and course_title:
                # Attempt to extract code from title if not present
                code_match = re.match(r"([A-Z]{2,5}\s*\d{2,3}[A-Z]?)", course_title)
                if code_match:
                    course_code = code_match.group(1).replace(" ", "")

            if course_code:
                course_obj = Course(
                    course_id=course_data.get("course_id") or course_code,
                    code=course_code,
                    title=course_title or "Unknown Course",
                    credits=float(course_data["units"]) if course_data.get("units") else 0.0,
                    description=course_data.get("description"),
                    subject=_subject_level(course_code)[0],
                    level=_subject_level(course_code)[1],
                )
                out.courses.append(course_obj)

            # Inject requirements/course sets for individual course, if any
            _inject_requirements_from_course_data(out, course_data)
    
    _ensure_provenance(out, scraped)
    return out

def _clean_and_deduplicate_courses(courses: List[Dict[str, str]]) -> List[Dict[str, str]]:
    seen_codes = set()
    cleaned_courses = []
    for course in courses:
        if course["code"] not in seen_codes:
            seen_codes.add(course["code"])
            cleaned_courses.append(course)
    return cleaned_courses

def process_single_entry(scraped: Dict[str, Any]) -> Dict[str, Any]:
    """Process a single scraped entry and return the normalized envelope as dict."""
    # No longer passing model to normalize_scraped since we're bypassing Ollama.
    # The 'model' argument can be removed from this function's signature if it's not used elsewhere.
    # For now, keeping it for compatibility but not using it.
    if scraped.get("_malformed"):
        env = OutputEnvelope(
            provenance={
                "ingested_at": _now_iso(),
                "fingerprint": hashlib.sha1(scraped.get("raw","").encode("utf-8")).hexdigest(),
                "error": f"JSON parse error on line {scraped.get('_line')}: {scraped.get('_error')}"
            }
        )
    else:
        env = normalize_scraped(scraped) # Pass an empty string for model as it's not used
    
    return json.loads(env.model_dump_json())

# -------------------------
# I/O
# -------------------------

def read_jsonl(fp) -> Iterable[Dict[str, Any]]:
    for i, line in enumerate(fp, 1):
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError as e:
            # Emit a warning envelope with the error captured in provenance
            yield {"_malformed": True, "_line": i, "_error": str(e), "raw": line}

def write_jsonl(fp, objs: Iterable[Dict[str, Any]]) -> None:
    for obj in objs:
        fp.write(json.dumps(obj, ensure_ascii=False) + "\n")
        fp.flush()

# -------------------------
# CLI
# -------------------------

def parse_args():
    ap = argparse.ArgumentParser(description="Normalize catalog JSONL with Ollama structured outputs.")
    ap.add_argument("--in", dest="inp", required=True, help="Input JSONL path or '-' for stdin")
    ap.add_argument("--out", dest="out", required=True, help="Output JSONL path or '-' for stdout")
    ap.add_argument("--model", dest="model", default="qwen2.5:14b-instruct", help="Ollama model (default: qwen2.5:14b-instruct)")
    ap.add_argument("--workers", dest="workers", type=int, default=3, help="Number of concurrent workers (default: 3)")
    return ap.parse_args()

def main():
    args = parse_args()
    model = _ollama_model(args.model)
    max_workers = args.workers

    fin = sys.stdin if args.inp == "-" else open(args.inp, "r", encoding="utf-8")
    fout = sys.stdout if args.out == "-" else open(args.out, "w", encoding="utf-8")

    try:
        # Thread-safe writing with a lock
        write_lock = threading.Lock()
        
        # Read all entries first to enable concurrent processing
        scraped_entries = list(read_jsonl(fin))
        
        # Process entries concurrently in batches
        batch = []
        batch_size = 5
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_entry = {
                executor.submit(process_single_entry, scraped): scraped 
                for scraped in scraped_entries
            }
            
            # Process completed tasks as they finish
            for future in as_completed(future_to_entry):
                try:
                    result = future.result()
                    batch.append(result)
                    
                    # Write batch when it reaches the batch size
                    if len(batch) >= batch_size:
                        with write_lock:
                            write_jsonl(fout, batch)
                        batch = []  # Reset batch
                        
                except Exception as exc:
                    print(f"Entry generated an exception: {exc}", file=sys.stderr)
        
        # Write any remaining entries in the final batch
        if batch:
            with write_lock:
                write_jsonl(fout, batch)
            
    finally:
        if fin is not sys.stdin: fin.close()
        if fout is not sys.stdout: fout.close()

if __name__ == "__main__":
    main()
