const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

// OpenAI configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = 'gpt-4o-mini'; // Cost-effective yet capable

// Assignment type base pricing
const ASSIGNMENT_PRICING = {
    // Standard page-based assignments
    standard: {
        bronze: { basePrice: 8.49 },
        silver: { basePrice: 12.49 },
        gold: { basePrice: 17.99 }
    },
    // Excel/spreadsheet work (per task/sheet complexity)
    excel: {
        simple: 25,      // Basic formulas, simple data entry
        moderate: 50,    // Pivot tables, charts, VLOOKUP
        complex: 100,    // Macros, VBA, complex analysis
        advanced: 175    // Full dashboard, automation
    },
    // Full course pricing
    course: {
        mini: 150,       // 2-4 weeks, few assignments
        standard: 350,   // 6-8 weeks, moderate workload
        intensive: 600,  // 10-12 weeks, heavy workload
        comprehensive: 1000 // Full semester, multiple subjects
    },
    // Programming/code work
    programming: {
        simple: 30,      // Basic script, single file
        moderate: 75,    // Multi-file, some complexity
        complex: 150,    // Full application, algorithms
        advanced: 300    // System design, architecture
    },
    // Presentations
    presentation: {
        perSlide: 3,     // Base per slide
        withNotes: 5,    // With speaker notes
        withResearch: 8  // With research and content creation
    },
    // Other/custom (AI will estimate)
    custom: {
        baseMinimum: 15,
        perHourEstimate: 12
    }
};

// Auth middleware
const authenticateMember = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'homework-pal-secret');
            if (decoded.type === 'client_member') {
                req.member = decoded;
            }
        } catch (error) {
            // Continue as guest
        }
    }
    next();
};

// AI-powered price estimation
async function getAIEstimate(assignmentDetails) {
    if (!OPENAI_API_KEY) {
        console.log('OpenAI API key not configured, using fallback estimation');
        return null;
    }

    const systemPrompt = `You are a pricing assistant for HomeworkPal, an academic assistance service. 
Your job is to estimate fair prices for various academic tasks based on complexity, time required, and skill level needed.

PRICING GUIDELINES:
- Standard written work: $8-18 per page (275 words)
- Excel/Spreadsheet: $25-175 depending on complexity
- Programming: $30-300 depending on scope
- Full courses: $150-1000 depending on duration/workload
- Presentations: $3-8 per slide
- Minimum order: $15

Consider these factors:
1. Time to complete (estimate hours)
2. Complexity/skill level required
3. Research requirements
4. Urgency (but don't add urgency fees, we include that in tier pricing)
5. Specialization needed

Always respond with a JSON object in this exact format:
{
  "estimatedPrice": <number>,
  "estimatedHours": <number>,
  "complexity": "simple|moderate|complex|advanced",
  "reasoning": "<brief explanation>",
  "breakdown": [
    {"item": "<description>", "amount": <number>}
  ]
}`;

    const userPrompt = `Estimate the price for this assignment:

Type: ${assignmentDetails.type}
Title: ${assignmentDetails.title || 'Not specified'}
Domain/Subject: ${assignmentDetails.domain || 'General'}
Description: ${assignmentDetails.description || 'No description'}
Deadline: ${assignmentDetails.deadlineHours || 72} hours
Package Tier: ${assignmentDetails.packageType || 'silver'}

Additional details:
- Pages (if applicable): ${assignmentDetails.pages || 'N/A'}
- Slides (if presentation): ${assignmentDetails.slides || 'N/A'}
- Tasks/problems (if applicable): ${assignmentDetails.tasks || 'N/A'}
- Course duration (if course): ${assignmentDetails.courseDuration || 'N/A'}
- Special requirements: ${assignmentDetails.specialRequirements || 'None'}

Provide a fair price estimate based on the complexity and work involved.`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 500
            })
        });

        if (!response.ok) {
            console.error('OpenAI API error:', await response.text());
            return null;
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        
        // Parse JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return null;
    } catch (error) {
        console.error('AI estimation error:', error);
        return null;
    }
}

// Calculate price based on assignment type
function calculateTypeBasedPrice(details) {
    const { type, packageType = 'silver', pages, slides, tasks, courseDuration, complexity = 'moderate' } = details;
    
    let basePrice = 0;
    let breakdown = [];
    
    switch (type) {
        case 'standard':
            // Page-based pricing
            const pageCount = parseInt(pages) || 1;
            const tierPricing = ASSIGNMENT_PRICING.standard[packageType] || ASSIGNMENT_PRICING.standard.silver;
            basePrice = pageCount * tierPricing.basePrice;
            breakdown.push({ item: `${pageCount} page(s) @ $${tierPricing.basePrice}/page`, amount: basePrice });
            break;
            
        case 'excel':
            basePrice = ASSIGNMENT_PRICING.excel[complexity] || ASSIGNMENT_PRICING.excel.moderate;
            const taskCount = parseInt(tasks) || 1;
            if (taskCount > 1) {
                basePrice = basePrice * (1 + (taskCount - 1) * 0.5); // 50% per additional task
            }
            breakdown.push({ item: `Excel work (${complexity} complexity)`, amount: basePrice });
            break;
            
        case 'course':
            const duration = courseDuration || 'standard';
            basePrice = ASSIGNMENT_PRICING.course[duration] || ASSIGNMENT_PRICING.course.standard;
            breakdown.push({ item: `Full course (${duration})`, amount: basePrice });
            break;
            
        case 'programming':
            basePrice = ASSIGNMENT_PRICING.programming[complexity] || ASSIGNMENT_PRICING.programming.moderate;
            breakdown.push({ item: `Programming work (${complexity} complexity)`, amount: basePrice });
            break;
            
        case 'presentation':
            const slideCount = parseInt(slides) || 10;
            const slidePrice = ASSIGNMENT_PRICING.presentation.withResearch;
            basePrice = slideCount * slidePrice;
            breakdown.push({ item: `${slideCount} slides @ $${slidePrice}/slide`, amount: basePrice });
            break;
            
        default:
            // Custom/other - use minimum
            basePrice = ASSIGNMENT_PRICING.custom.baseMinimum;
            breakdown.push({ item: 'Custom assignment (base)', amount: basePrice });
    }
    
    return { basePrice, breakdown };
}

// Smart price calculation endpoint
router.post('/calculate', authenticateMember, async (req, res) => {
    try {
        const {
            type = 'standard',
            packageType = 'silver',
            pages,
            slides,
            tasks,
            courseDuration,
            complexity,
            title,
            domain,
            description,
            deadlineHours = 72,
            specialRequirements,
            useAI = false
        } = req.body;
        
        let priceResult;
        let aiEstimate = null;
        
        // For complex or custom assignments, use AI estimation
        if (useAI || type === 'custom' || type === 'course') {
            aiEstimate = await getAIEstimate({
                type,
                packageType,
                pages,
                slides,
                tasks,
                courseDuration,
                title,
                domain,
                description,
                deadlineHours,
                specialRequirements
            });
        }
        
        // Calculate base price using rules
        const ruleBasedPrice = calculateTypeBasedPrice({
            type,
            packageType,
            pages,
            slides,
            tasks,
            courseDuration,
            complexity
        });
        
        // Use AI estimate if available and reasonable, otherwise use rule-based
        let finalBasePrice = ruleBasedPrice.basePrice;
        let breakdown = ruleBasedPrice.breakdown;
        let estimatedHours = null;
        let aiReasoning = null;
        
        if (aiEstimate && aiEstimate.estimatedPrice) {
            // Validate AI estimate is within reasonable bounds (50% - 200% of rule-based)
            const aiPrice = aiEstimate.estimatedPrice;
            if (aiPrice >= ruleBasedPrice.basePrice * 0.5 && aiPrice <= ruleBasedPrice.basePrice * 2) {
                finalBasePrice = aiPrice;
                breakdown = aiEstimate.breakdown || breakdown;
                estimatedHours = aiEstimate.estimatedHours;
                aiReasoning = aiEstimate.reasoning;
            } else if (type === 'custom' || type === 'course') {
                // For custom/course, trust AI more
                finalBasePrice = aiPrice;
                breakdown = aiEstimate.breakdown || breakdown;
                estimatedHours = aiEstimate.estimatedHours;
                aiReasoning = aiEstimate.reasoning;
            }
        }
        
        // Get member discount
        let discountPercent = 0;
        let discountAmount = 0;
        let memberTier = null;
        
        if (req.member) {
            const memberResult = await pool.query(
                'SELECT discount_percent, membership_tier, is_verified FROM client_members WHERE id = $1',
                [req.member.memberId]
            );
            if (memberResult.rows.length > 0 && memberResult.rows[0].is_verified) {
                discountPercent = parseFloat(memberResult.rows[0].discount_percent) || 0;
                memberTier = memberResult.rows[0].membership_tier;
                discountAmount = finalBasePrice * (discountPercent / 100);
            }
        }
        
        const finalPrice = finalBasePrice - discountAmount;
        
        res.json({
            success: true,
            breakdown: {
                assignmentType: type,
                packageType,
                basePrice: finalBasePrice.toFixed(2),
                subtotal: finalBasePrice.toFixed(2),
                memberTier,
                discountPercent,
                discountAmount: discountAmount.toFixed(2),
                finalPrice: finalPrice.toFixed(2),
                estimatedHours,
                itemizedBreakdown: breakdown,
                aiReasoning,
                complexity: aiEstimate?.complexity || complexity || 'moderate',
                // For standard type, include page info
                ...(type === 'standard' && {
                    pages: parseInt(pages) || 1,
                    pricePerPage: (ASSIGNMENT_PRICING.standard[packageType]?.basePrice || 12.49).toFixed(2)
                }),
                // For presentation, include slide info
                ...(type === 'presentation' && {
                    slides: parseInt(slides) || 10
                }),
                // For course, include duration
                ...(type === 'course' && {
                    courseDuration: courseDuration || 'standard'
                })
            }
        });
        
    } catch (error) {
        console.error('Error calculating price:', error);
        res.status(500).json({ error: 'Failed to calculate price' });
    }
});

// Get pricing guide (for UI)
router.get('/pricing-guide', (req, res) => {
    res.json({
        success: true,
        pricing: {
            standard: {
                description: 'Written assignments (essays, papers, reports)',
                unit: 'per page (~275 words)',
                tiers: {
                    bronze: '$8.49/page',
                    silver: '$12.49/page',
                    gold: '$17.99/page'
                }
            },
            excel: {
                description: 'Spreadsheet & data work',
                levels: {
                    simple: { price: '$25', examples: 'Basic formulas, simple data entry' },
                    moderate: { price: '$50', examples: 'Pivot tables, charts, VLOOKUP' },
                    complex: { price: '$100', examples: 'Macros, VBA, complex analysis' },
                    advanced: { price: '$175', examples: 'Full dashboards, automation' }
                }
            },
            course: {
                description: 'Full course assistance',
                levels: {
                    mini: { price: 'From $150', duration: '2-4 weeks' },
                    standard: { price: 'From $350', duration: '6-8 weeks' },
                    intensive: { price: 'From $600', duration: '10-12 weeks' },
                    comprehensive: { price: 'From $1000', duration: 'Full semester' }
                }
            },
            programming: {
                description: 'Code & software development',
                levels: {
                    simple: { price: '$30', examples: 'Basic script, single file' },
                    moderate: { price: '$75', examples: 'Multi-file project' },
                    complex: { price: '$150', examples: 'Full application' },
                    advanced: { price: '$300', examples: 'System design' }
                }
            },
            presentation: {
                description: 'PowerPoint & presentation slides',
                pricing: '$3-8 per slide',
                note: 'Price varies based on research and content creation needs'
            },
            membership: {
                note: 'Members save up to 20% on every order!',
                tiers: ['Basic (5%)', 'Silver (10%)', 'Gold (15%)', 'Platinum (20%)']
            }
        }
    });
});

module.exports = router;
