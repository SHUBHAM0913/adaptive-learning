"""Curriculum seed: 16-concept Physics DAG, 64-question bank with tagged
distractors, prerequisite edges, and a demo student with realistic history
(one broken root prerequisite + forgotten concepts) so the dashboard is alive
on first run."""

import json
import uuid
from datetime import datetime, timedelta, timezone

from database import Base, engine, SessionLocal
from models import (
    Concept,
    Prerequisite,
    Question,
    Student,
    StudentAttemptItem,
)


CURRICULUM = [
    {"concept_id": "c01", "name": "Scalars and Vectors", "topic_id": "Mechanics",
     "description": "Quantities with and without direction; vector addition.", "exam_relevance": 0.75, "difficulty_weight": 0.25, "estimated_minutes": 30},
    {"concept_id": "c02", "name": "Distance, Displacement, Speed, Velocity", "topic_id": "Kinematics",
     "description": "Describing motion: path length vs straight-line change, rates.", "exam_relevance": 0.85, "difficulty_weight": 0.30, "estimated_minutes": 30},
    {"concept_id": "c03", "name": "Acceleration", "topic_id": "Kinematics",
     "description": "Rate of change of velocity, uniform acceleration equations.", "exam_relevance": 0.90, "difficulty_weight": 0.45, "estimated_minutes": 40},
    {"concept_id": "c04", "name": "Newton's First Law (Inertia)", "topic_id": "Dynamics",
     "description": "Objects keep their state unless a net external force acts.", "exam_relevance": 0.85, "difficulty_weight": 0.30, "estimated_minutes": 30},
    {"concept_id": "c05", "name": "Newton's Second Law (F = ma)", "topic_id": "Dynamics",
     "description": "Net force, mass and acceleration: the core law of motion.", "exam_relevance": 0.95, "difficulty_weight": 0.55, "estimated_minutes": 45},
    {"concept_id": "c06", "name": "Newton's Third Law", "topic_id": "Dynamics",
     "description": "Action-reaction pairs — equal and opposite.", "exam_relevance": 0.90, "difficulty_weight": 0.40, "estimated_minutes": 35},
    {"concept_id": "c07", "name": "Free Body Diagrams", "topic_id": "Dynamics",
     "description": "Isolating an object and drawing every force acting on it.", "exam_relevance": 0.90, "difficulty_weight": 0.60, "estimated_minutes": 45},
    {"concept_id": "c08", "name": "Friction", "topic_id": "Dynamics",
     "description": "Static and kinetic friction, factors that control it.", "exam_relevance": 0.85, "difficulty_weight": 0.50, "estimated_minutes": 40},
    {"concept_id": "c09", "name": "Work", "topic_id": "Work and Energy",
     "description": "Force times displacement along the force, W = Fd cos θ.", "exam_relevance": 0.90, "difficulty_weight": 0.55, "estimated_minutes": 40},
    {"concept_id": "c10", "name": "Kinetic Energy", "topic_id": "Work and Energy",
     "description": "Energy of motion, KE = ½mv², work-energy theorem.", "exam_relevance": 0.90, "difficulty_weight": 0.50, "estimated_minutes": 35},
    {"concept_id": "c11", "name": "Potential Energy", "topic_id": "Work and Energy",
     "description": "Stored energy, gravitational PE = mgh.", "exam_relevance": 0.90, "difficulty_weight": 0.50, "estimated_minutes": 35},
    {"concept_id": "c12", "name": "Conservation of Energy", "topic_id": "Work and Energy",
     "description": "Energy transforms between forms; total stays constant.", "exam_relevance": 0.95, "difficulty_weight": 0.65, "estimated_minutes": 45},
    {"concept_id": "c13", "name": "Momentum", "topic_id": "Momentum",
     "description": "p = mv, impulse and its relation to force.", "exam_relevance": 0.90, "difficulty_weight": 0.55, "estimated_minutes": 40},
    {"concept_id": "c14", "name": "Conservation of Momentum", "topic_id": "Momentum",
     "description": "Momentum stays constant in closed systems; collisions.", "exam_relevance": 0.95, "difficulty_weight": 0.70, "estimated_minutes": 45},
    {"concept_id": "c15", "name": "Circular Motion", "topic_id": "Rotational",
     "description": "Centripetal acceleration and force, v²/r.", "exam_relevance": 0.85, "difficulty_weight": 0.70, "estimated_minutes": 45},
    {"concept_id": "c16", "name": "Gravitation", "topic_id": "Gravitation",
     "description": "Universal gravitation, g, mass vs weight, orbits.", "exam_relevance": 0.90, "difficulty_weight": 0.65, "estimated_minutes": 45},
]

# Edge from -> to means "you must know 'from' before 'to' makes sense".
PREREQUISITES = [
    ("c01", "c02"),
    ("c01", "c07"),
    ("c02", "c03"),
    ("c03", "c05"),
    ("c04", "c05"),
    ("c05", "c07"),
    ("c05", "c08"),
    ("c07", "c08"),
    ("c05", "c09"),
    ("c09", "c10"),
    ("c09", "c11"),
    ("c10", "c12"),
    ("c11", "c12"),
    ("c02", "c13"),
    ("c05", "c13"),
    ("c13", "c14"),
    ("c03", "c15"),
    ("c05", "c15"),
    ("c15", "c16"),
    ("c11", "c16"),
]

# Each question: correct index + distractors keyed by option LETTER (A-D).
# Distractor strings carry one of the taxonomy tags so the error classifier
# can say WHY the student picked that answer.
QUESTIONS = [
    # ---- c01 Scalars and Vectors
    {"qid": "q01_01", "concept": "c01", "text": "Which of these is a VECTOR quantity?",
     "options": ["Speed", "Distance", "Displacement", "Time"], "correct": 2, "difficulty": 0.30,
     "discrimination": 1.0, "est": 40,
     "distractors": {"A": "FORMULA_SELECTION_ERROR: Speed is a scalar — magnitude only.",
                     "B": "CONCEPTUAL_ERROR: Distance is a scalar; only displacement carries direction.",
                     "D": "CONCEPTUAL_ERROR: Time is a scalar — it has no direction."}},
    {"qid": "q01_02", "concept": "c01", "text": "A car drives 3 km north then 4 km east. The magnitude of its displacement is:",
     "options": ["7 km", "1 km", "5 km", "12 km"], "correct": 2, "difficulty": 0.55,
     "discrimination": 1.2, "est": 75,
     "distractors": {"A": "CALCULATION_ERROR: 3+4=7 adds the path lengths, but displacement is the straight-line resultant.",
                     "B": "SIGN_ERROR: 4−3=1 subtracts magnitudes — the legs are perpendicular, so use Pythagoras.",
                     "D": "CALCULATION_ERROR: 3×4=12 multiplies the legs — displacement is the hypotenuse."}},
    {"qid": "q01_03", "concept": "c01", "text": "Two vectors are added using the:",
     "options": ["adding their magnitudes", "head-to-tail rule", "subtracting their lengths", "multiplying their values"],
     "correct": 1, "difficulty": 0.45, "discrimination": 1.0, "est": 45,
     "distractors": {"A": "CONCEPTUAL_ERROR: Magnitudes only add when the vectors point the same way.",
                     "C": "FORMULA_SELECTION_ERROR: Subtraction gives the difference vector, not the sum.",
                     "D": "CARELESS_ERROR: Vectors are never combined by multiplication in addition."}},
    {"qid": "q01_04", "concept": "c01", "text": "Which statement is TRUE?",
     "options": ["A vector has only magnitude", "A vector has magnitude AND direction",
                 "A scalar has direction", "Speed is a vector"], "correct": 1, "difficulty": 0.35,
     "discrimination": 1.0, "est": 40,
     "distractors": {"A": "CONCEPTUAL_ERROR: Magnitude-only quantities are scalars, not vectors.",
                     "C": "CONCEPTUAL_ERROR: Scalars have magnitude only — no direction.",
                     "D": "CONCEPTUAL_ERROR: Speed is a scalar; velocity carries the direction."}},
    # ---- c02 Distance/Displacement/Speed/Velocity
    {"qid": "q02_01", "concept": "c02", "text": "Average SPEED equals:",
     "options": ["total displacement ÷ time", "total distance ÷ time", "velocity × time", "acceleration × time"],
     "correct": 1, "difficulty": 0.40, "discrimination": 1.0, "est": 45,
     "distractors": {"A": "FORMULA_SELECTION_ERROR: That is average VELOCITY — speed uses total distance, not displacement.",
                     "C": "FORMULA_SELECTION_ERROR: v×t gives distance, not average speed.",
                     "D": "FORMULA_SELECTION_ERROR: a×t gives change in velocity, not speed."}},
    {"qid": "q02_02", "concept": "c02", "text": "A runner completes one lap of a 400 m track in 80 s. Her average VELOCITY is:",
     "options": ["5 m/s", "0 m/s", "400 m/s", "0.2 m/s"], "correct": 1, "difficulty": 0.60,
     "discrimination": 1.4, "est": 60,
     "distractors": {"A": "CONCEPTUAL_ERROR: 400/80 = 5 m/s is the average SPEED. Velocity uses displacement, which is 0 after a full lap.",
                     "C": "CALCULATION_ERROR: 400/80 is not 400 m/s — recheck the division.",
                     "D": "CALCULATION_ERROR: 80/400 inverts the fraction."}},
    {"qid": "q02_03", "concept": "c02", "text": "Velocity is measured in:",
     "options": ["m", "m/s", "m/s²", "s"], "correct": 1, "difficulty": 0.25,
     "discrimination": 0.9, "est": 30,
     "distractors": {"A": "UNIT_ERROR: m is distance, not a rate.",
                     "C": "UNIT_ERROR: m/s² is the unit of acceleration.",
                     "D": "UNIT_ERROR: s is time, not velocity."}},
    {"qid": "q02_04", "concept": "c02", "text": "A bus covers 60 km in 1.5 h. Its average speed is:",
     "options": ["90 km/h", "40 km/h", "30 km/h", "61.5 km/h"], "correct": 1, "difficulty": 0.45,
     "discrimination": 1.0, "est": 50,
     "distractors": {"A": "CALCULATION_ERROR: 60×1.5 multiplies distance and time — divide distance by time.",
                     "C": "CALCULATION_ERROR: 60/2 halves the time — the time is 1.5 h, not 2 h.",
                     "D": "READING_ERROR: 60+1.5 adds quantities with different units."}},
    # ---- c03 Acceleration
    {"qid": "q03_01", "concept": "c03", "text": "Acceleration is defined as:",
     "options": ["v ÷ t", "Δv ÷ Δt", "d ÷ t", "F ÷ v"], "correct": 1, "difficulty": 0.40,
     "discrimination": 1.0, "est": 45,
     "distractors": {"A": "FORMULA_SELECTION_ERROR: v/t works only from rest — the full definition uses the CHANGE in velocity.",
                     "C": "FORMULA_SELECTION_ERROR: d/t is speed, not acceleration.",
                     "D": "FORMULA_SELECTION_ERROR: F/v is not a standard definition."}},
    {"qid": "q03_02", "concept": "c03", "text": "A car goes from 0 to 20 m/s in 5 s. Its acceleration is:",
     "options": ["4 m/s²", "100 m/s²", "0.25 m/s²", "20 m/s²"], "correct": 0, "difficulty": 0.50,
     "discrimination": 1.2, "est": 60,
     "distractors": {"B": "CALCULATION_ERROR: 20×5 = 100 multiplies — divide the change in velocity by the time.",
                     "C": "CALCULATION_ERROR: 5/20 inverts the ratio — it is 20/5.",
                     "D": "CONCEPTUAL_ERROR: 20 m/s² ignores time — acceleration is a RATE of change."}},
    {"qid": "q03_03", "concept": "c03", "text": "A negative acceleration means the object:",
     "options": ["always speeds up", "has acceleration opposite to its velocity direction",
                 "always stops", "always slows down"], "correct": 1, "difficulty": 0.55,
     "discrimination": 1.2, "est": 50,
     "distractors": {"A": "CONCEPTUAL_ERROR: If velocity is already negative, negative acceleration INCREASES speed.",
                     "C": "CONCEPTUAL_ERROR: Negative acceleration alone does not mean stopping.",
                     "D": "CONCEPTUAL_ERROR: Same trap — it depends on the sign of the velocity."}},
    {"qid": "q03_04", "concept": "c03", "text": "A ball is thrown straight up at 30 m/s (g = 10 m/s²). Time to reach its highest point:",
     "options": ["3 s", "300 s", "0.33 s", "6 s"], "correct": 0, "difficulty": 0.65,
     "discrimination": 1.3, "est": 75,
     "distractors": {"B": "CALCULATION_ERROR: 30×10 multiplies — divide velocity by g.",
                     "C": "CALCULATION_ERROR: 10/30 inverts the ratio.",
                     "D": "SIGN_ERROR: 2×30/10 is the total flight time — the time UP is half of that."}},
    # ---- c04 Newton's First Law
    {"qid": "q04_01", "concept": "c04", "text": "Newton's first law: an object stays at rest or in uniform motion unless:",
     "options": ["friction acts", "an unbalanced external force acts", "it has mass", "time passes"],
     "correct": 1, "difficulty": 0.35, "discrimination": 1.0, "est": 40,
     "distractors": {"A": "CONCEPTUAL_ERROR: Friction IS an unbalanced force — the law is about NET force.",
                     "C": "CONCEPTUAL_ERROR: Mass alone does not change motion.",
                     "D": "CONCEPTUAL_ERROR: Time passing does not cause motion changes."}},
    {"qid": "q04_02", "concept": "c04", "text": "Passengers lurch forward when a bus stops suddenly because of:",
     "options": ["inertia", "gravity", "friction", "momentum loss"], "correct": 0, "difficulty": 0.45,
     "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CONCEPTUAL_ERROR: Gravity pulls down — it does not throw you forward.",
                     "C": "CONCEPTUAL_ERROR: Friction stops the BUS; your body's inertia keeps it moving.",
                     "D": "FORMULA_SELECTION_ERROR: Momentum is conserved — the lurch is explained by inertia."}},
    {"qid": "q04_03", "concept": "c04", "text": "A book at rest on a table stays at rest because:",
     "options": ["no forces act on it", "the forces on it balance to zero net force",
                 "gravity on it is very small", "the table pushes down on it"], "correct": 1,
     "difficulty": 0.50, "discrimination": 1.1, "est": 50,
     "distractors": {"A": "CONCEPTUAL_ERROR: Gravity and the normal force DO act — they cancel to zero NET force.",
                     "C": "CONCEPTUAL_ERROR: Gravity is not small; the normal force balances it.",
                     "D": "CONCEPTUAL_ERROR: The table pushes UP — that is what balances gravity."}},
    {"qid": "q04_04", "concept": "c04", "text": "In deep space with no forces at all, an object in uniform motion will:",
     "options": ["slow down and stop", "continue at constant velocity", "speed up", "fall"],
     "correct": 1, "difficulty": 0.40, "discrimination": 1.0, "est": 40,
     "distractors": {"A": "CONCEPTUAL_ERROR: No force means no change — it will not slow by itself.",
                     "C": "CONCEPTUAL_ERROR: Speeding up requires an unbalanced force.",
                     "D": "CONCEPTUAL_ERROR: Falling requires gravity — a force."}},
    # ---- c05 Newton's Second Law
    {"qid": "q05_01", "concept": "c05", "text": "Newton's second law gives force as:",
     "options": ["m ÷ a", "m × a", "m + a", "a ÷ m"], "correct": 1, "difficulty": 0.35,
     "discrimination": 1.0, "est": 35,
     "distractors": {"A": "FORMULA_SELECTION_ERROR: That inverts the relation — force is mass TIMES acceleration.",
                     "C": "FORMULA_SELECTION_ERROR: m+a adds unlike quantities.",
                     "D": "FORMULA_SELECTION_ERROR: That is the inverse — check the formula."}},
    {"qid": "q05_02", "concept": "c05", "text": "A 10 kg object accelerates at 2 m/s². The net force on it is:",
     "options": ["5 N", "20 N", "12 N", "0.2 N"], "correct": 1, "difficulty": 0.45,
     "discrimination": 1.0, "est": 50,
     "distractors": {"A": "CALCULATION_ERROR: 10/2 divides — multiply mass by acceleration.",
                     "C": "CALCULATION_ERROR: 10+2 adds — force is the product of mass and acceleration.",
                     "D": "CALCULATION_ERROR: 2/10 inverts the product."}},
    {"qid": "q05_03", "concept": "c05", "text": "The SAME force acts on a 2 kg mass and an 8 kg mass. The 2 kg mass gets:",
     "options": ["4× the acceleration", "the same acceleration", "¼ the acceleration", "4× the force"],
     "correct": 0, "difficulty": 0.60, "discrimination": 1.3, "est": 60,
     "distractors": {"B": "CONCEPTUAL_ERROR: a = F/m — smaller mass means LARGER acceleration.",
                     "C": "CONCEPTUAL_ERROR: That is the 8 kg mass — acceleration is inversely proportional to mass.",
                     "D": "CONCEPTUAL_ERROR: The force is stated to be the same on both."}},
    {"qid": "q05_04", "concept": "c05", "text": "Net force on a 5 kg mass accelerating at 3 m/s²:",
     "options": ["15 N", "1.67 N", "8 N", "53 N"], "correct": 0, "difficulty": 0.40,
     "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CALCULATION_ERROR: 5/3 divides — use F = ma.",
                     "C": "CALCULATION_ERROR: 5+3 adds the values.",
                     "D": "CALCULATION_ERROR: 5³ misreads the notation — it is 5×3."}},
    # ---- c06 Newton's Third Law
    {"qid": "q06_01", "concept": "c06", "text": "Newton's third law says every action has:",
     "options": ["an equal and opposite reaction", "a smaller reaction", "no reaction", "a same-direction reaction"],
     "correct": 0, "difficulty": 0.30, "discrimination": 1.0, "est": 35,
     "distractors": {"B": "CONCEPTUAL_ERROR: The reaction is exactly EQUAL in magnitude, always.",
                     "C": "CONCEPTUAL_ERROR: Forces always come in pairs.",
                     "D": "CONCEPTUAL_ERROR: The reaction is opposite in direction."}},
    {"qid": "q06_02", "concept": "c06", "text": "A 5 N book rests on a table. The REACTION to the book's weight is:",
     "options": ["the table pushing up on the book with 5 N", "the book pushing down on the table",
                 "the Earth pulling the book", "the air pressing on the book"], "correct": 0,
     "difficulty": 0.65, "discrimination": 1.4, "est": 70,
     "distractors": {"B": "CONCEPTUAL_ERROR: The book pressing the table is the ACTION — its reaction is the table pushing UP on the book.",
                     "C": "CONCEPTUAL_ERROR: Earth pulling the book IS the weight itself, not its reaction.",
                     "D": "CONCEPTUAL_ERROR: Air pressure is unrelated to this action–reaction pair."}},
    {"qid": "q06_03", "concept": "c06", "text": "A rocket lifts off because:",
     "options": ["it pushes exhaust down and the exhaust pushes the rocket up",
                 "it pushes against the air", "gravity repels it", "friction with the sky"],
     "correct": 0, "difficulty": 0.55, "discrimination": 1.1, "est": 55,
     "distractors": {"B": "CONCEPTUAL_ERROR: Rockets work in a vacuum — they push exhaust, not air.",
                     "C": "CONCEPTUAL_ERROR: Gravity opposes the rocket; it is not the propulsion.",
                     "D": "CONCEPTUAL_ERROR: There is no 'sky friction' — not a real force."}},
    {"qid": "q06_04", "concept": "c06", "text": "You push a wall and it does not move. The wall:",
     "options": ["exerts no force on you", "pushes back on you with an equal force",
                 "absorbs your force completely", "is too heavy to react"], "correct": 1,
     "difficulty": 0.50, "discrimination": 1.2, "est": 50,
     "distractors": {"A": "CONCEPTUAL_ERROR: The wall pushes back equally — it stays put because it is anchored.",
                     "C": "CONCEPTUAL_ERROR: Forces do not disappear; they balance.",
                     "D": "CONCEPTUAL_ERROR: Mass does not cancel the third-law pair."}},
    # ---- c07 Free Body Diagrams
    {"qid": "q07_01", "concept": "c07", "text": "A free body diagram shows:",
     "options": ["only the object itself", "all forces acting ON the object",
                 "all forces the object exerts on others", "only gravity"], "correct": 1,
     "difficulty": 0.35, "discrimination": 1.0, "est": 40,
     "distractors": {"A": "CONCEPTUAL_ERROR: The diagram must include the forces acting on the object.",
                     "C": "CONCEPTUAL_ERROR: FBDs show forces ON the object, not forces it exerts on others.",
                     "D": "CONCEPTUAL_ERROR: All contact and field forces, not just gravity."}},
    {"qid": "q07_02", "concept": "c07", "text": "Forces on a book at rest on a table (in its FBD):",
     "options": ["weight only", "weight + normal force", "normal force only", "weight + normal + your push"],
     "correct": 1, "difficulty": 0.45, "discrimination": 1.0, "est": 45,
     "distractors": {"A": "CONCEPTUAL_ERROR: The table pushes up with a normal force — otherwise the book would fall.",
                     "C": "CONCEPTUAL_ERROR: Gravity always acts on the book.",
                     "D": "CONCEPTUAL_ERROR: Your push exists only if you are pushing — do not invent forces."}},
    {"qid": "q07_03", "concept": "c07", "text": "A block is pushed across a rough floor. The forces acting on it are:",
     "options": ["weight, normal, friction, applied push", "weight only",
                 "normal and friction only", "friction only"], "correct": 0, "difficulty": 0.55,
     "discrimination": 1.2, "est": 55,
     "distractors": {"B": "CONCEPTUAL_ERROR: The floor pushes up (normal) and opposes motion (friction).",
                     "C": "CONCEPTUAL_ERROR: Missing the weight — gravity always acts.",
                     "D": "CONCEPTUAL_ERROR: Missing the applied push and the weight."}},
    {"qid": "q07_04", "concept": "c07", "text": "An FBD shows 10 N upward and 6 N downward on an object. The net force is:",
     "options": ["4 N upward", "16 N upward", "4 N downward", "6 N downward"], "correct": 0,
     "difficulty": 0.50, "discrimination": 1.1, "est": 50,
     "distractors": {"B": "SIGN_ERROR: 10+6 adds opposite directions — opposing forces subtract.",
                     "C": "SIGN_ERROR: 10−6=4 points toward the LARGER force (up), not down.",
                     "D": "CONCEPTUAL_ERROR: Net force is the difference, not just the smaller force."}},
    # ---- c08 Friction
    {"qid": "q08_01", "concept": "c08", "text": "Static friction acts:",
     "options": ["only while an object is moving", "before sliding starts",
                 "only after sliding begins", "in the direction of motion"], "correct": 1,
     "difficulty": 0.45, "discrimination": 1.0, "est": 45,
     "distractors": {"A": "CONCEPTUAL_ERROR: Static friction acts to PREVENT motion from starting.",
                     "C": "CONCEPTUAL_ERROR: That is kinetic friction.",
                     "D": "CONCEPTUAL_ERROR: Friction opposes motion or attempted motion."}},
    {"qid": "q08_02", "concept": "c08", "text": "Friction between two surfaces depends mainly on:",
     "options": ["surface roughness and the normal force", "the area of contact",
                 "the speed of sliding", "the colour of the surfaces"], "correct": 0, "difficulty": 0.50,
     "discrimination": 1.1, "est": 50,
     "distractors": {"B": "CONCEPTUAL_ERROR: In the basic model, friction is roughly independent of contact area.",
                     "C": "CONCEPTUAL_ERROR: Kinetic friction is roughly independent of speed.",
                     "D": "CARELESS_ERROR: Colour does not affect friction."}},
    {"qid": "q08_03", "concept": "c08", "text": "We slip on ice because:",
     "options": ["ice is smooth, giving very low friction", "ice is heavy",
                 "ice attracts water", "gravity stops working on ice"], "correct": 0, "difficulty": 0.35,
     "discrimination": 1.0, "est": 40,
     "distractors": {"B": "CONCEPTUAL_ERROR: Weight does not remove friction.",
                     "C": "CONCEPTUAL_ERROR: That is not why slipping happens.",
                     "D": "CONCEPTUAL_ERROR: Gravity still acts — friction is what is low."}},
    {"qid": "q08_04", "concept": "c08", "text": "Pressing harder on a block (increasing the normal force) makes friction:",
     "options": ["increase", "decrease", "stay the same", "disappear"], "correct": 0, "difficulty": 0.40,
     "discrimination": 1.0, "est": 40,
     "distractors": {"B": "CONCEPTUAL_ERROR: Friction is proportional to the normal force.",
                     "C": "CONCEPTUAL_ERROR: Normal force is one of the two controlling factors.",
                     "D": "CONCEPTUAL_ERROR: Pressing harder cannot remove friction."}},
    # ---- c09 Work
    {"qid": "q09_01", "concept": "c09", "text": "Work done by a force is:",
     "options": ["F ÷ d", "F · d · cos θ", "F · a", "m · v"], "correct": 1, "difficulty": 0.40,
     "discrimination": 1.0, "est": 45,
     "distractors": {"A": "FORMULA_SELECTION_ERROR: F/d is not work — work is force times displacement along the force.",
                     "C": "FORMULA_SELECTION_ERROR: F·a is not a standard quantity.",
                     "D": "FORMULA_SELECTION_ERROR: m·v is momentum, not work."}},
    {"qid": "q09_02", "concept": "c09", "text": "You push hard against a wall that does not move. The work done by you is:",
     "options": ["zero", "F × d", "maximum", "negative"], "correct": 0, "difficulty": 0.55,
     "discrimination": 1.3, "est": 60,
     "distractors": {"B": "CONCEPTUAL_ERROR: Work requires displacement — the wall does not move, so no work is done.",
                     "C": "CONCEPTUAL_ERROR: No displacement means no work, however hard you push.",
                     "D": "CONCEPTUAL_ERROR: Negative work needs displacement opposite to the force."}},
    {"qid": "q09_03", "concept": "c09", "text": "A 10 N force moves an object 5 m along the force. Work done:",
     "options": ["50 J", "2 J", "15 J", "0.5 J"], "correct": 0, "difficulty": 0.35,
     "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CALCULATION_ERROR: 10/5 divides — multiply force by displacement.",
                     "C": "CALCULATION_ERROR: 10+5 adds — work is the product F×d.",
                     "D": "CALCULATION_ERROR: 5/10 inverts the product."}},
    {"qid": "q09_04", "concept": "c09", "text": "Work is measured in:",
     "options": ["joules", "newtons", "watts", "pascals"], "correct": 0, "difficulty": 0.25,
     "discrimination": 0.9, "est": 30,
     "distractors": {"B": "UNIT_ERROR: Newton is the unit of force.",
                     "C": "UNIT_ERROR: Watt is power — work per second.",
                     "D": "UNIT_ERROR: Pascal is pressure."}},
    # ---- c10 Kinetic Energy
    {"qid": "q10_01", "concept": "c10", "text": "Kinetic energy equals:",
     "options": ["½mv²", "mv", "mgh", "½mv"], "correct": 0, "difficulty": 0.35,
     "discrimination": 1.0, "est": 40,
     "distractors": {"B": "FORMULA_SELECTION_ERROR: mv is momentum, not energy.",
                     "C": "FORMULA_SELECTION_ERROR: mgh is gravitational potential energy.",
                     "D": "FORMULA_SELECTION_ERROR: The velocity must be squared — KE = ½mv²."}},
    {"qid": "q10_02", "concept": "c10", "text": "Doubling an object's speed quadruples its:",
     "options": ["kinetic energy", "momentum", "mass", "weight"], "correct": 0, "difficulty": 0.55,
     "discrimination": 1.2, "est": 55,
     "distractors": {"B": "CONCEPTUAL_ERROR: Momentum doubles (mv), but KE is proportional to v².",
                     "C": "CONCEPTUAL_ERROR: Mass is unchanged.",
                     "D": "CONCEPTUAL_ERROR: Weight (mg) is unchanged."}},
    {"qid": "q10_03", "concept": "c10", "text": "KE of a 2 kg object moving at 3 m/s:",
     "options": ["9 J", "18 J", "6 J", "3 J"], "correct": 0, "difficulty": 0.50,
     "discrimination": 1.1, "est": 55,
     "distractors": {"B": "CALCULATION_ERROR: ½×2×3² = 9, not 18 — square the velocity first.",
                     "C": "CALCULATION_ERROR: 2×3 = 6 skips both the ½ and the square.",
                     "D": "CALCULATION_ERROR: ½×2×3 = 3 forgets to square the velocity."}},
    {"qid": "q10_04", "concept": "c10", "text": "The work done on an object equals its change in:",
     "options": ["kinetic energy", "mass", "temperature", "weight"], "correct": 0, "difficulty": 0.45,
     "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CONCEPTUAL_ERROR: Work does not change mass.",
                     "C": "CONCEPTUAL_ERROR: Friction can heat things, but the work–energy theorem is about KE.",
                     "D": "CONCEPTUAL_ERROR: Work changes energy, not weight."}},
    # ---- c11 Potential Energy
    {"qid": "q11_01", "concept": "c11", "text": "Gravitational potential energy near Earth's surface equals:",
     "options": ["mgh", "½mv²", "F ÷ d", "ma"], "correct": 0, "difficulty": 0.35,
     "discrimination": 1.0, "est": 40,
     "distractors": {"B": "FORMULA_SELECTION_ERROR: ½mv² is kinetic energy.",
                     "C": "FORMULA_SELECTION_ERROR: F/d is not an energy.",
                     "D": "FORMULA_SELECTION_ERROR: ma is force."}},
    {"qid": "q11_02", "concept": "c11", "text": "PE of a 2 kg book 5 m above the ground (g = 10 m/s²):",
     "options": ["100 J", "50 J", "20 J", "10 J"], "correct": 0, "difficulty": 0.50,
     "discrimination": 1.1, "est": 55,
     "distractors": {"B": "CALCULATION_ERROR: ½×2×10×5 borrows the KE factor — PE = mgh, no half.",
                     "C": "CALCULATION_ERROR: 2×10 = 20 misses the height of 5 m.",
                     "D": "CALCULATION_ERROR: 2×5 = 10 misses gravity (g = 10)."}},
    {"qid": "q11_03", "concept": "c11", "text": "Raising a ball higher above the ground increases its:",
     "options": ["potential energy", "kinetic energy", "mass", "speed"], "correct": 0,
     "difficulty": 0.40, "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CONCEPTUAL_ERROR: Height does not directly change kinetic energy.",
                     "C": "CONCEPTUAL_ERROR: Mass is intrinsic to the object.",
                     "D": "CONCEPTUAL_ERROR: Speed is independent of height here."}},
    {"qid": "q11_04", "concept": "c11", "text": "Gravitational PE is measured relative to:",
     "options": ["any chosen reference level", "sea level only", "the object's centre", "the ground only"],
     "correct": 0, "difficulty": 0.50, "discrimination": 1.1, "est": 50,
     "distractors": {"B": "CONCEPTUAL_ERROR: Any reference level works — PE DIFFERENCES are what matter.",
                     "C": "CONCEPTUAL_ERROR: Height is measured from the reference level, not the centre.",
                     "D": "CONCEPTUAL_ERROR: The ground is one valid reference, but not the only one."}},
    # ---- c12 Conservation of Energy
    {"qid": "q12_01", "concept": "c12", "text": "On a frictionless swing, energy:",
     "options": ["converts between kinetic and potential, total constant", "disappears at the top",
                 "is created at the bottom", "is lost as heat"], "correct": 0, "difficulty": 0.45,
     "discrimination": 1.1, "est": 50,
     "distractors": {"B": "CONCEPTUAL_ERROR: Energy is not destroyed — it transforms.",
                     "C": "CONCEPTUAL_ERROR: Energy cannot be created from nothing.",
                     "D": "CONCEPTUAL_ERROR: With no friction there is no heat loss."}},
    {"qid": "q12_02", "concept": "c12", "text": "A ball dropped from a height: at its LOWEST point, its energy is mostly:",
     "options": ["kinetic", "potential", "thermal", "nuclear"], "correct": 0, "difficulty": 0.40,
     "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CONCEPTUAL_ERROR: PE is maximum at the TOP; at the bottom the height is minimum.",
                     "C": "CONCEPTUAL_ERROR: Without friction there is no heat.",
                     "D": "CARELESS_ERROR: Nuclear energy is irrelevant here."}},
    {"qid": "q12_03", "concept": "c12", "text": "A ball thrown straight up: at the top of its path, ",
     "options": ["KE = 0 and PE is maximum", "KE is maximum and PE = 0",
                 "both KE and PE are zero", "both KE and PE are maximum"], "correct": 0,
     "difficulty": 0.55, "discrimination": 1.2, "est": 55,
     "distractors": {"B": "CONCEPTUAL_ERROR: At the top the speed is zero — KE is zero and PE is maximum.",
                     "C": "CONCEPTUAL_ERROR: Total energy is conserved — it cannot all be zero.",
                     "D": "CONCEPTUAL_ERROR: Both cannot be maximum — energy converts between them."}},
    {"qid": "q12_04", "concept": "c12", "text": "Energy 'lost' to friction is converted into:",
     "options": ["heat", "mass", "light", "nothing"], "correct": 0, "difficulty": 0.45,
     "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CONCEPTUAL_ERROR: Mass–energy conversion is nuclear physics, not friction.",
                     "C": "CONCEPTUAL_ERROR: A little light maybe, but the main sink is heat.",
                     "D": "CONCEPTUAL_ERROR: Energy is conserved — it changes form."}},
    # ---- c13 Momentum
    {"qid": "q13_01", "concept": "c13", "text": "Momentum equals:",
     "options": ["mv", "ma", "mgh", "½mv²"], "correct": 0, "difficulty": 0.30,
     "discrimination": 1.0, "est": 35,
     "distractors": {"B": "FORMULA_SELECTION_ERROR: ma is force.",
                     "C": "FORMULA_SELECTION_ERROR: mgh is potential energy.",
                     "D": "FORMULA_SELECTION_ERROR: ½mv² is kinetic energy."}},
    {"qid": "q13_02", "concept": "c13", "text": "Momentum of a 3 kg object moving at 4 m/s:",
     "options": ["12 kg·m/s", "7 kg·m/s", "1.33 kg·m/s", "24 kg·m/s"], "correct": 0,
     "difficulty": 0.40, "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CALCULATION_ERROR: 3+4 adds — momentum is the product.",
                     "C": "CALCULATION_ERROR: 4/3 divides.",
                     "D": "CALCULATION_ERROR: ½×3×4² is kinetic energy, not momentum."}},
    {"qid": "q13_03", "concept": "c13", "text": "Two objects have equal momentum. The LIGHTER one must have:",
     "options": ["a higher speed", "a lower speed", "the same speed", "more mass"],
     "correct": 0, "difficulty": 0.55, "discrimination": 1.2, "est": 55,
     "distractors": {"B": "CONCEPTUAL_ERROR: p = mv is fixed — a smaller mass needs a larger velocity.",
                     "C": "CONCEPTUAL_ERROR: Speeds differ since the masses differ.",
                     "D": "CONCEPTUAL_ERROR: The lighter one is given as lighter."}},
    {"qid": "q13_04", "concept": "c13", "text": "Momentum is a ______ quantity.",
     "options": ["vector", "scalar", "dimensionless", "thermal"], "correct": 0, "difficulty": 0.35,
     "discrimination": 1.0, "est": 35,
     "distractors": {"B": "CONCEPTUAL_ERROR: Momentum has a direction, inherited from velocity.",
                     "C": "CONCEPTUAL_ERROR: It has units of kg·m/s.",
                     "D": "CARELESS_ERROR: Momentum is not a thermal quantity."}},
    # ---- c14 Conservation of Momentum
    {"qid": "q14_01", "concept": "c14", "text": "In a closed system with no external forces, total momentum:",
     "options": ["stays constant", "increases steadily", "decreases steadily", "always becomes zero"],
     "correct": 0, "difficulty": 0.40, "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CONCEPTUAL_ERROR: No external force means no change.",
                     "C": "CONCEPTUAL_ERROR: Momentum transfers between objects, but the total holds.",
                     "D": "CONCEPTUAL_ERROR: It is zero only if it started as zero."}},
    {"qid": "q14_02", "concept": "c14", "text": "A 4 kg ball moving at 5 m/s hits a stationary 1 kg ball and stops. If the 1 kg ball moves off in the same direction, its speed is:",
     "options": ["20 m/s", "5 m/s", "4 m/s", "1.25 m/s"], "correct": 0, "difficulty": 0.70,
     "discrimination": 1.4, "est": 80,
     "distractors": {"B": "CALCULATION_ERROR: 5 m/s would require equal masses.",
                     "C": "CALCULATION_ERROR: Solve p: 4×5 = 1×v, so v = 20 m/s.",
                     "D": "CALCULATION_ERROR: 5/4 inverts the mass ratio."}},
    {"qid": "q14_03", "concept": "c14", "text": "A gun recoils backward when fired because of:",
     "options": ["conservation of momentum", "friction", "gravity", "air resistance"],
     "correct": 0, "difficulty": 0.50, "discrimination": 1.1, "est": 50,
     "distractors": {"B": "CONCEPTUAL_ERROR: Friction slows the recoil later — the recoil itself is momentum conservation.",
                     "C": "CONCEPTUAL_ERROR: Gravity pulls the gun down, not backward.",
                     "D": "CONCEPTUAL_ERROR: Air is not the mechanism."}},
    {"qid": "q14_04", "concept": "c14", "text": "Two objects that stick together after a collision form a:",
     "options": ["perfectly inelastic collision", "perfectly elastic collision", "impossible collision", "frictionless collision"],
     "correct": 0, "difficulty": 0.45, "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CONCEPTUAL_ERROR: Elastic collisions bounce apart without sticking.",
                     "C": "CONCEPTUAL_ERROR: Sticking collisions happen all the time.",
                     "D": "CONCEPTUAL_ERROR: Frictionlessness is unrelated to sticking."}},
    # ---- c15 Circular Motion
    {"qid": "q15_01", "concept": "c15", "text": "Centripetal force points:",
     "options": ["toward the centre of the circle", "away from the centre",
                 "tangent to the circle", "straight down"], "correct": 0, "difficulty": 0.50,
     "discrimination": 1.2, "est": 50,
     "distractors": {"B": "CONCEPTUAL_ERROR: Outward is centrifugal — a pseudo-force. The real force points inward.",
                     "C": "CONCEPTUAL_ERROR: Tangent is the velocity direction, not the force.",
                     "D": "CONCEPTUAL_ERROR: Downward is gravity's direction, not centripetal in general."}},
    {"qid": "q15_02", "concept": "c15", "text": "Centripetal acceleration equals:",
     "options": ["v²/r", "v/r", "v·r", "r/v"], "correct": 0, "difficulty": 0.45,
     "discrimination": 1.0, "est": 45,
     "distractors": {"B": "FORMULA_SELECTION_ERROR: v/r is not acceleration.",
                     "C": "FORMULA_SELECTION_ERROR: v·r is not acceleration.",
                     "D": "FORMULA_SELECTION_ERROR: r/v inverts the ratio."}},
    {"qid": "q15_03", "concept": "c15", "text": "A bucket of water whirled in a vertical circle keeps its water at the TOP because:",
     "options": ["the bucket exerts the inward force needed to keep the water in circular motion",
                 "the water's weight pushes it up", "water is very light", "air holds the water in"],
     "correct": 0, "difficulty": 0.65, "discrimination": 1.3, "est": 70,
     "distractors": {"B": "CONCEPTUAL_ERROR: Weight pulls DOWN at the top — the bucket provides the inward force.",
                     "C": "CONCEPTUAL_ERROR: Lightness is not a force.",
                     "D": "CONCEPTUAL_ERROR: Air cannot hold water in a spinning bucket."}},
    {"qid": "q15_04", "concept": "c15", "text": "A car turning a corner relies on friction to provide the:",
     "options": ["centripetal force", "centrifugal force", "forward driving force", "braking force"],
     "correct": 0, "difficulty": 0.55, "discrimination": 1.2, "est": 55,
     "distractors": {"B": "CONCEPTUAL_ERROR: Centrifugal is a pseudo-force felt in the rotating frame.",
                     "C": "CONCEPTUAL_ERROR: Here friction points toward the turn's centre, not forward.",
                     "D": "CONCEPTUAL_ERROR: Friction is turning the car, not stopping it."}},
    # ---- c16 Gravitation
    {"qid": "q16_01", "concept": "c16", "text": "Gravitational force between two masses is proportional to:",
     "options": ["the product of the masses and the inverse square of the distance",
                 "the sum of the masses", "the distance between them", "the larger mass only"],
     "correct": 0, "difficulty": 0.50, "discrimination": 1.1, "est": 55,
     "distractors": {"B": "FORMULA_SELECTION_ERROR: Force ∝ m₁·m₂, not their sum.",
                     "C": "CONCEPTUAL_ERROR: Force DEcreases with distance squared.",
                     "D": "CONCEPTUAL_ERROR: Both masses matter, and distance matters too."}},
    {"qid": "q16_02", "concept": "c16", "text": "The acceleration due to gravity on Earth's surface is about:",
     "options": ["9.8 m/s²", "98 m/s²", "0.98 m/s²", "980 m/s²"], "correct": 0, "difficulty": 0.30,
     "discrimination": 0.9, "est": 35,
     "distractors": {"B": "CALCULATION_ERROR: 9.8×10 misplaces the decimal.",
                     "C": "CALCULATION_ERROR: 9.8÷10 misplaces the decimal.",
                     "D": "CALCULATION_ERROR: 9.8×100 misplaces the decimal."}},
    {"qid": "q16_03", "concept": "c16", "text": "Astronauts in orbit feel weightless because:",
     "options": ["they are in continuous free fall around Earth", "gravity is zero at that altitude",
                 "they have lost their mass", "the air is too thin"], "correct": 0, "difficulty": 0.60,
     "discrimination": 1.3, "est": 65,
     "distractors": {"B": "CONCEPTUAL_ERROR: Gravity at orbital altitude is ~90% of Earth's — they are falling around Earth.",
                     "C": "CONCEPTUAL_ERROR: Mass is unchanged in orbit.",
                     "D": "CONCEPTUAL_ERROR: Thin air is not why they float."}},
    {"qid": "q16_04", "concept": "c16", "text": "Mass and weight: weight is:",
     "options": ["a force equal to mg", "the same thing as mass", "measured in kilograms", "constant everywhere"],
     "correct": 0, "difficulty": 0.40, "discrimination": 1.0, "est": 45,
     "distractors": {"B": "CONCEPTUAL_ERROR: Mass is matter; weight is the gravitational force on it.",
                     "C": "UNIT_ERROR: kg measures mass; weight is a force in newtons.",
                     "D": "CONCEPTUAL_ERROR: Weight changes with g; mass does not."}},
]

DEMO_HISTORY = {
    # concept -> list of (is_correct, time_taken_s) — the demo student's sessions
    "c01": [(False, 9), (False, 55), (True, 60), (False, 12), (True, 75)],  # weak root, 2 guesses
    "c02": [(True, 50), (False, 65), (True, 40), (False, 20), (True, 55)],
    "c03": [(False, 48), (True, 52), (False, 70), (True, 45), (True, 60)],
    "c04": [(True, 35), (True, 40), (False, 85), (True, 38), (True, 50)],
    "c05": [(True, 55), (False, 80), (True, 48), (True, 60), (False, 25)],
    "c06": [(True, 40), (True, 45), (True, 55), (False, 70), (True, 42)],
    "c07": [(True, 50), (False, 70), (False, 20), (True, 55), (False, 75)],  # weak -> broken-chain demo
    "c08": [(True, 45), (True, 50), (False, 30), (True, 48)],
    "c09": [(True, 50), (False, 60), (True, 45), (True, 55)],
    "c10": [(True, 45), (True, 58), (False, 75), (True, 42)],
    "c11": [(True, 40), (True, 52), (True, 48), (False, 65)],
    "c13": [(False, 30), (True, 48), (True, 52), (True, 44)],
    "c15": [(True, 55), (False, 60), (True, 50), (True, 58)],
}

# Concepts the demo student practised ~12 days ago (stale -> forgetting risk).
STALE_CONCEPTS = {"c01", "c04", "c06", "c07", "c10", "c11"}

_LETTERS = "ABCD"


def _question_records():
    """Expand question dicts into DB Question rows."""
    out = []
    for q in QUESTIONS:
        options = q["options"]
        correct_letter = _LETTERS[q["correct"]]
        out.append(
            Question(
                question_id=q["qid"],
                concept_id=q["concept"],
                question_text=q["text"],
                options=json.dumps(options),
                correct_answer=correct_letter,
                difficulty=q["difficulty"],
                discrimination=q["discrimination"],
                estimated_time_seconds=q["est"],
                distractor_explanations=json.dumps(q["distractors"]),
            )
        )
    return out


def seed(create_demo: bool = True):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Concept).count() == 0:
            for c in CURRICULUM:
                db.add(Concept(**c))
            for i, (frm, to) in enumerate(PREREQUISITES, start=1):
                db.add(
                    Prerequisite(
                        prereq_id=f"pr{i:02d}", from_concept_id=frm, to_concept_id=to
                    )
                )
            for q in _question_records():
                db.add(q)
            db.commit()

        if create_demo and db.query(Student).filter_by(student_id="demo").first() is None:
            _seed_demo_student(db)
    finally:
        db.close()


def _seed_demo_student(db):
    from pipeline import process_responses

    now = datetime.now(timezone.utc)
    student = Student(student_id="demo", name="Demo Student", target_exam="Boards")
    db.add(student)
    db.commit()

    for concept_id, history in DEMO_HISTORY.items():
        stale = concept_id in STALE_CONCEPTS
        session_time = now - timedelta(days=12 if stale else 1)

        # Map each response to a real question of that concept so the
        # full pipeline (error classify -> IRT -> BKT -> mastery) runs on it.
        questions = (
            db.query(Question).filter_by(concept_id=concept_id).order_by(Question.question_id).all()
        )
        responses = []
        for idx, (is_correct, time_taken) in enumerate(history):
            q = questions[idx % len(questions)]
            if is_correct:
                answer = q.correct_answer
            else:
                # pick a plausible wrong distractor (the one with a tag)
                distractors = json.loads(q.distractor_explanations or "{}")
                wrong = [k for k in distractors if k != q.correct_answer]
                answer = wrong[idx % len(wrong)] if wrong else _LETTERS[0]
            responses.append(
                {
                    "question_id": q.question_id,
                    "student_answer": answer,
                    "time_taken_seconds": time_taken,
                }
            )
        process_responses(db, "demo", responses, as_of=session_time)

    db.commit()


if __name__ == "__main__":
    seed()
    print("Seeded curriculum + demo student.")